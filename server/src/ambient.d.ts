// Minimal ambient declarations for npm packages without their own TS types.
// We only need the surface our code actually calls — fully typing these is
// out of scope. Keep them tight so the rest of the codebase still benefits
// from strict checks.

declare module "adm-zip" {
  class AdmZip {
    constructor(path?: string | Buffer);
    getEntries(): Array<{ entryName: string; isDirectory: boolean; header?: { size?: number } }>;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
    readAsText(entryName: string): string;
  }
  export default AdmZip;
}

declare module "pdf-parse-fork" {
  type ParseResult = { text: string; numpages: number; info?: unknown; metadata?: unknown };
  function parse(buffer: Buffer, opts?: { max?: number }): Promise<ParseResult>;
  export default parse;
}

declare module "mammoth" {
  type ConvertResult = { value: string; messages?: { type: string; message: string }[] };
  export function convertToMarkdown(input: { buffer: Buffer }): Promise<ConvertResult>;
  export function extractRawText(input: { buffer: Buffer }): Promise<ConvertResult>;
  const _default: { convertToMarkdown: typeof convertToMarkdown; extractRawText: typeof extractRawText };
  export default _default;
}

// `xlsx` ships its own types via the SheetJS CDN tarball, but to keep the
// build resilient we declare a tiny surface covering only what we use.
declare module "xlsx" {
  export const utils: {
    sheet_to_csv(sheet: unknown, opts?: { blankrows?: boolean }): string;
  };
  export function readFile(path: string, opts?: { cellDates?: boolean; cellText?: boolean }): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
}
