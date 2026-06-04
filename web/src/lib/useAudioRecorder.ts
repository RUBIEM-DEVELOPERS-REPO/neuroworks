import { useCallback, useEffect, useRef, useState } from "react";

// Records a short audio clip from the user's mic via MediaRecorder, then hands
// back a Blob to upload for server-side transcription (/api/stt). Unlike the
// browser Web Speech API this works across Chrome/Edge/Firefox and keeps the
// STT provider/key server-side. getUserMedia requires a secure context —
// satisfied on https and on localhost (127.0.0.1), which is how the app runs.

export type UseAudioRecorder = {
  supported: boolean;
  recording: boolean;
  error: string | null;
  start: () => Promise<void>;
  /** Stops recording and resolves the recorded audio (null if nothing captured). */
  stop: () => Promise<Blob | null>;
};

export function useAudioRecorder(): UseAudioRecorder {
  const [supported] = useState(() =>
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const start = useCallback(async () => {
    if (recording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      // Prefer webm/opus; fall back to the browser default (Safari → mp4).
      const mime = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm" : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e: any) {
      cleanupStream();
      setError(e?.name === "NotAllowedError" || e?.name === "SecurityError"
        ? "Microphone access denied"
        : (e?.message ?? "Could not start microphone"));
      setRecording(false);
    }
  }, [recording]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec || rec.state === "inactive") { setRecording(false); cleanupStream(); resolve(null); return; }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        cleanupStream();
        recRef.current = null;
        setRecording(false);
        resolve(blob.size > 0 ? blob : null);
      };
      try { rec.stop(); } catch { setRecording(false); cleanupStream(); resolve(null); }
    });
  }, []);

  useEffect(() => () => { cleanupStream(); }, []);

  return { supported, recording, error, start, stop };
}
