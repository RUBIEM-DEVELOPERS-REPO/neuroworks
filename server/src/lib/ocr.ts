// OCR for image-only documents.
//
// Two engines:
//   - "local"  → tesseract.js, fully offline. Handles raster images (PNG/JPG/
//                etc.) directly. Slow first-page warmup (~3-5s loading the
//                worker + traineddata), <1s per page after.
//   - "cloud"  → OpenRouter, sending the file (PDF or image) as base64 to a
//                multimodal model. Faster, more accurate for messy scans,
//                accepts PDFs natively (Claude / Gemini do). Costs OpenRouter
//                credits. Used when local can't help (e.g. PDF input) or when
//                the operator explicitly picks engine="cloud".
//   - "auto"   → For images, local first. For PDFs, cloud (we can't render
//                PDFs to images without native deps). Falls back to the
//                other engine if the first attempt yields <50 chars.
//
// The cloud path uses OpenRouter's OpenAI-compatible chat completions API
// with the multimodal `content` array (image_url / file_url). PDF support is
// model-dependent: anthropic/claude-3.5-sonnet, google/gemini-2.0-flash-001,
// and openai/gpt-4o all accept the format we send.

import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { config } from "../config.js";

export type OcrEngine = "auto" | "local" | "cloud";

export type OcrResult = {
  text: string;
  engine: "local" | "cloud";
  model?: string;
  confidence?: number;
  pages?: number;
  bytes: number;
  truncated: boolean;
};

const MAX_BYTES_IN = 25 * 1024 * 1024;
const MAX_BYTES_OUT = 500_000;
const MIN_USEFUL_CHARS = 50;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"]);
const PDF_EXTS = new Set([".pdf"]);

// Cached tesseract worker — first call pays the load cost, subsequent calls
// reuse the same worker. Shared across the process so a hot fleet member
// only ever loads English data once.
let _tesseractWorker: any | null = null;
let _tesseractLoadingPromise: Promise<any> | null = null;

async function getTesseractWorker(): Promise<any> {
  if (_tesseractWorker) return _tesseractWorker;
  if (_tesseractLoadingPromise) return _tesseractLoadingPromise;
  _tesseractLoadingPromise = (async () => {
    const tes = await import("tesseract.js");
    const create = (tes as any).createWorker;
    if (!create) throw new Error("tesseract.js: createWorker not found");
    // English by default. Adding more languages: pass an array.
    // Logger is silenced — tesseract is chatty and the logs bloat trace
    // output; we still surface page-level progress to the caller.
    const worker = await create("eng", undefined, { logger: () => {} });
    _tesseractWorker = worker;
    return worker;
  })();
  return _tesseractLoadingPromise;
}

export async function shutdownOcrWorker(): Promise<void> {
  if (_tesseractWorker) {
    try { await _tesseractWorker.terminate(); } catch { /* ignore */ }
    _tesseractWorker = null;
  }
  _tesseractLoadingPromise = null;
}

async function ocrLocal(buf: Buffer, ext: string): Promise<OcrResult> {
  const worker = await getTesseractWorker();
  // PDFs: tesseract.js can't read PDF bytes directly — render each page to
  // a PNG via pdfjs-dist + @napi-rs/canvas (both pure JS, no native build).
  // Cap at 20 pages so a massive PDF can't burn 5 minutes of CPU.
  if (ext === ".pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as any);
    const { createCanvas } = await import("@napi-rs/canvas");
    const data = new Uint8Array(buf);
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
    const maxPages = Math.min(20, doc.numPages);
    const parts: string[] = [];
    let avgConf = 0;
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx as any, viewport }).promise;
      const png = canvas.toBuffer("image/png");
      const { data: d } = await worker.recognize(png);
      parts.push(String(d?.text ?? "").trim());
      if (typeof d?.confidence === "number") avgConf += d.confidence;
    }
    avgConf = maxPages > 0 ? avgConf / maxPages : 0;
    const fullText = parts.join("\n\n---\n\n").trim();
    return {
      text: fullText.slice(0, MAX_BYTES_OUT),
      engine: "local",
      confidence: avgConf,
      pages: maxPages,
      bytes: buf.length,
      truncated: fullText.length > MAX_BYTES_OUT,
    };
  }
  // Image — tesseract takes the buffer directly.
  const { data } = await worker.recognize(buf);
  const text = String(data?.text ?? "").trim();
  const confidence = typeof data?.confidence === "number" ? data.confidence : undefined;
  return {
    text: text.slice(0, MAX_BYTES_OUT),
    engine: "local",
    confidence,
    bytes: buf.length,
    truncated: text.length > MAX_BYTES_OUT,
  };
}

async function ocrCloud(buf: Buffer, ext: string): Promise<OcrResult> {
  if (!config.openrouterApiKey) {
    throw new Error("cloud OCR unavailable: OPENROUTER_API_KEY not set");
  }
  // Pick a multimodal model that accepts our content type. Override via
  // NEUROWORKS_OCR_CLOUD_MODEL. Defaults to a Gemini flash model — it's fast,
  // cheap, accepts PDFs natively, and OpenRouter routes it cleanly. The
  // anthropic claude family is a strong fallback for messy scans.
  const model = process.env.NEUROWORKS_OCR_CLOUD_MODEL ?? "google/gemini-2.0-flash-001";
  const mime = mimeForExt(ext);
  const isPdf = ext === ".pdf";
  const b64 = buf.toString("base64");

  // OpenRouter follows the OpenAI-compatible chat completions schema; the
  // multimodal content array uses image_url for images. For PDFs we use the
  // `file` content type that anthropic + gemini accept on OpenRouter — the
  // dataURL prefix tells the model it's a PDF.
  const userContent: any[] = [
    { type: "text", text: "Extract ALL readable text from this document. Output ONLY the extracted text — no commentary, no markdown formatting, no summary. Preserve line breaks and layout where possible." },
    isPdf
      ? { type: "file", file: { filename: `document${ext}`, file_data: `data:${mime};base64,${b64}` } }
      : { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
  ];

  const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.openrouterApiKey}`,
      "HTTP-Referer": config.openrouterAppUrl,
      "X-Title": config.openrouterAppName,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.0,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`cloud OCR ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as any;
  const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
  return {
    text: text.slice(0, MAX_BYTES_OUT),
    engine: "cloud",
    model: json?.model ?? model,
    bytes: buf.length,
    truncated: text.length > MAX_BYTES_OUT,
  };
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".tif":
    case ".tiff": return "image/tiff";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

export async function ocrFile(absPath: string, engine: OcrEngine = "auto"): Promise<OcrResult> {
  const st = statSync(absPath);
  if (!st.isFile()) throw new Error(`ocr: not a file — ${absPath}`);
  if (st.size > MAX_BYTES_IN) throw new Error(`ocr: file too large (${st.size} bytes, cap ${MAX_BYTES_IN})`);
  const ext = extname(absPath).toLowerCase();
  if (!IMAGE_EXTS.has(ext) && !PDF_EXTS.has(ext)) {
    throw new Error(`ocr: unsupported extension ${ext} — only ${[...IMAGE_EXTS, ...PDF_EXTS].join(", ")} are handled`);
  }
  const buf = readFileSync(absPath);

  // Engine selection. Local OCR handles both images AND PDFs (PDF pages
  // get rendered to PNG via pdfjs+napi-canvas). Cloud is the fallback when
  // local fails or the operator explicitly opts in.
  if (engine === "local") {
    return await ocrLocal(buf, ext);
  }
  if (engine === "cloud") {
    return await ocrCloud(buf, ext);
  }
  // auto — local first, cloud fallback only if local returned poor results
  // AND the cloud path is actually usable.
  try {
    const local = await ocrLocal(buf, ext);
    const goodEnough = local.text.length >= MIN_USEFUL_CHARS && (local.confidence ?? 100) >= 40;
    if (goodEnough) return local;
    if (!config.openrouterApiKey) return local;
    try {
      const cloud = await ocrCloud(buf, ext);
      return cloud.text.length > local.text.length ? cloud : local;
    } catch { return local; }
  } catch (localErr: any) {
    if (config.openrouterApiKey) return await ocrCloud(buf, ext);
    throw localErr;
  }
}

export function ocrSupportsExt(ext: string): boolean {
  const e = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return IMAGE_EXTS.has(e) || PDF_EXTS.has(e);
}
