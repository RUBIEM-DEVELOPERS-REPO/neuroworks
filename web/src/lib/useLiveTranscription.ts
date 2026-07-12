import { useCallback, useRef, useState } from "react";
import { api } from "./api";

// Live speech-to-text: the browser opens its OWN WebSocket straight to
// AssemblyAI's Universal-Streaming API (wss://streaming.assemblyai.com/v3/ws)
// using a short-lived, single-use token minted server-side
// (GET /api/stt/realtime-token — the real API key never reaches the
// browser). Audio is captured raw (mono PCM16 @ 16kHz, AssemblyAI's
// required format — NOT the compressed webm/opus MediaRecorder produces,
// which is a different container and isn't documented as accepted here) via
// an AudioWorklet, resampled if the browser didn't honor the requested
// AudioContext rate, and streamed as ~50ms binary frames.
//
// AssemblyAI sends back `Turn` messages as the user talks: interim ones
// (end_of_turn: false) carry the current in-progress sentence and get
// REPLACED by the next interim message for that same turn (not appended —
// each message is the full transcript-so-far for the turn); end_of_turn:
// true finalizes it. onTurn(transcript, isFinal) is called for each one so
// the caller can render text live instead of waiting for the whole
// recording to end.

const WS_ENDPOINT = "wss://streaming.assemblyai.com/v3/ws";
const SAMPLE_RATE = 16000;
// ~50ms of audio per AssemblyAI's own guidance — small enough for low
// latency, large enough not to spam tiny frames.
const FRAME_SAMPLES = Math.round(SAMPLE_RATE * 0.05);

// Runs in the AudioWorklet's isolated global scope (no access to window/
// react) — posts raw Float32 samples for the main thread to resample,
// convert to PCM16, and batch into frames. Inlined as a Blob URL so this
// hook doesn't need a separate static asset file wired through Vite.
const WORKLET_SRC = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Float32Array is transferred by copy here (structured clone), not
      // transferred ownership — cheap at 128 samples/callback.
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCaptureProcessor);
`;

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Linear-interpolation resample — only exercised if the browser didn't
// honor the AudioContext({ sampleRate: 16000 }) request (most modern
// Chrome/Edge/Firefox do; this is a defensive fallback, not the common
// path). Good enough for speech-to-text; not meant to be audiophile-grade.
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] + (input[i1] - input[i0]) * frac;
  }
  return out;
}

export type UseLiveTranscription = {
  supported: boolean;
  active: boolean;
  error: string | null;
  /** Start streaming. onTurn fires for every interim/final transcript update. */
  start: (onTurn: (transcript: string, isFinal: boolean) => void) => Promise<void>;
  stop: () => void;
};

export function useLiveTranscription(): UseLiveTranscription {
  const [supported] = useState(() =>
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof WebSocket !== "undefined");
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const pendingRef = useRef<Float32Array[]>([]);
  const pendingLenRef = useRef(0);
  const workletUrlRef = useRef<string | null>(null);

  const teardown = useCallback(() => {
    try { workletRef.current?.disconnect(); } catch { /* tolerate */ }
    workletRef.current = null;
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* tolerate */ }
    streamRef.current = null;
    try { void ctxRef.current?.close(); } catch { /* tolerate */ }
    ctxRef.current = null;
    if (workletUrlRef.current) { URL.revokeObjectURL(workletUrlRef.current); workletUrlRef.current = null; }
    pendingRef.current = [];
    pendingLenRef.current = 0;
    setActive(false);
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "Terminate" })); } catch { /* tolerate */ }
      // Give AssemblyAI a moment to flush a final Turn + send Termination
      // before we close from our end; close it ourselves regardless after
      // a short grace period so a dropped ack never leaves the socket open.
      setTimeout(() => { try { ws.close(); } catch { /* tolerate */ } }, 800);
    } else {
      try { ws?.close(); } catch { /* tolerate */ }
    }
    wsRef.current = null;
    teardown();
  }, [teardown]);

  // Resolves once the WebSocket is genuinely OPEN (not just constructed) —
  // callers use this to decide whether to fall back to a different capture
  // path. Rejects on any failure up through connection establishment;
  // failures AFTER that point (a mid-session drop) just update `error`/
  // `active` state instead, since the caller has already committed to this
  // path and there's a live recording to tear down cleanly, not retry.
  const start = useCallback((onTurn: (transcript: string, isFinal: boolean) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
      (async () => {
        if (active) { resolve(); return; }
        setError(null);
        if (!supported) { const m = "Live transcription isn't supported in this browser"; setError(m); reject(new Error(m)); return; }

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          });
        } catch (e: any) {
          const m = e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "Microphone access denied" : (e?.message ?? "Could not start microphone");
          setError(m);
          reject(new Error(m));
          return;
        }
        streamRef.current = stream;

        let tokenRes: { token: string };
        try {
          tokenRes = await api.sttRealtimeToken();
        } catch (e: any) {
          const m = e?.message ?? "Could not start live transcription";
          setError(m);
          teardown();
          reject(new Error(m));
          return;
        }

        let opened = false;
        try {
          // Ask for 16kHz directly — if the browser can't honor it,
          // actualRate below reflects what it actually gave us and
          // resample() covers the gap.
          let ctx: AudioContext;
          try { ctx = new AudioContext({ sampleRate: SAMPLE_RATE }); }
          catch { ctx = new AudioContext(); }
          ctxRef.current = ctx;
          const actualRate = ctx.sampleRate;

          const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
          const workletUrl = URL.createObjectURL(blob);
          workletUrlRef.current = workletUrl;
          await ctx.audioWorklet.addModule(workletUrl);

          const source = ctx.createMediaStreamSource(stream);
          const worklet = new AudioWorkletNode(ctx, "pcm-capture");
          workletRef.current = worklet;
          source.connect(worklet);
          // No connection to ctx.destination — capture only, not monitoring
          // the mic through the speakers.

          const params = new URLSearchParams({
            sample_rate: String(SAMPLE_RATE),
            speech_model: "universal-3-5-pro",
            token: tokenRes.token,
          });
          const ws = new WebSocket(`${WS_ENDPOINT}?${params.toString()}`);
          ws.binaryType = "arraybuffer";
          wsRef.current = ws;

          ws.onopen = () => { opened = true; setActive(true); resolve(); };
          ws.onerror = () => {
            const m = "Live transcription connection failed";
            setError(m);
            if (!opened) { teardown(); reject(new Error(m)); }
          };
          ws.onclose = () => { setActive(false); };
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
              if (msg?.type === "Turn" && typeof msg.transcript === "string") {
                onTurn(msg.transcript, !!msg.end_of_turn);
              }
            } catch { /* non-JSON / binary frame from the server — ignore */ }
          };

          worklet.port.onmessage = (ev: MessageEvent<Float32Array>) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const chunk = actualRate === SAMPLE_RATE ? ev.data : resample(ev.data, actualRate, SAMPLE_RATE);
            pendingRef.current.push(chunk);
            pendingLenRef.current += chunk.length;
            // Batch worklet callbacks (128 samples each) up to ~50ms frames
            // before sending — matches AssemblyAI's guidance and avoids
            // spamming the socket with tiny WS frames.
            if (pendingLenRef.current >= FRAME_SAMPLES) {
              const merged = new Float32Array(pendingLenRef.current);
              let off = 0;
              for (const c of pendingRef.current) { merged.set(c, off); off += c.length; }
              pendingRef.current = [];
              pendingLenRef.current = 0;
              const pcm = floatTo16BitPCM(merged);
              ws.send(pcm.buffer);
            }
          };
        } catch (e: any) {
          const m = e?.message ?? "Could not start live transcription";
          setError(m);
          teardown();
          if (!opened) reject(new Error(m));
        }
      })();
    });
  }, [active, supported, teardown]);

  return { supported, active, error, start, stop };
}
