// Markdown → .docx converter. Walks the marked token tree and emits the
// minimum docx primitives that cover real-world reports: headings, prose
// paragraphs, ordered + unordered lists, GFM tables, blockquotes, inline
// emphasis + code, fenced code blocks. The output opens in Word / Pages /
// LibreOffice unchanged — no Pandoc, no Office install.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, BorderStyle, ShadingType, WidthType,
} from "docx";
import { marked, type Tokens } from "marked";

function inlineRuns(text: string): TextRun[] {
  // Lightweight inline parser. marked's tokeniser at top level returns
  // 'text' tokens whose nested inline structure we synthesise here. The
  // patterns ranked by precedence: code, then bold, then italic, then link.
  const parts: { text: string; bold?: boolean; italic?: boolean; code?: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    // code
    let m = text.slice(i).match(/^`([^`]+)`/);
    if (m) { parts.push({ text: m[1], code: true }); i += m[0].length; continue; }
    // bold
    m = text.slice(i).match(/^\*\*([^*]+)\*\*/);
    if (m) { parts.push({ text: m[1], bold: true }); i += m[0].length; continue; }
    // italic (single asterisk)
    m = text.slice(i).match(/^\*([^*]+)\*/);
    if (m) { parts.push({ text: m[1], italic: true }); i += m[0].length; continue; }
    // link [text](url) — render text only
    m = text.slice(i).match(/^\[([^\]]+)\]\([^)]+\)/);
    if (m) { parts.push({ text: m[1] }); i += m[0].length; continue; }
    // plain — accumulate until next special char
    const next = text.slice(i).search(/[`*\[]/);
    const chunk = next === -1 ? text.slice(i) : text.slice(i, i + Math.max(1, next));
    if (!parts.length || parts[parts.length - 1].code || parts[parts.length - 1].bold || parts[parts.length - 1].italic) {
      parts.push({ text: chunk });
    } else {
      parts[parts.length - 1].text += chunk;
    }
    i += chunk.length;
    if (next === -1) break;
  }
  if (!parts.length) parts.push({ text });
  return parts.map(p => new TextRun({ text: p.text, bold: p.bold, italics: p.italic, font: p.code ? "Consolas" : undefined }));
}

function headingLevelFor(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (depth) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    default: return HeadingLevel.HEADING_6;
  }
}

function tokensToBlocks(tokens: Tokens.Generic[]): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  for (const tok of tokens) {
    if (tok.type === "heading") {
      blocks.push(new Paragraph({
        heading: headingLevelFor((tok as any).depth),
        children: inlineRuns((tok as any).text ?? ""),
      }));
    } else if (tok.type === "paragraph") {
      blocks.push(new Paragraph({ children: inlineRuns((tok as any).text ?? "") }));
    } else if (tok.type === "blockquote") {
      const inner = tokensToBlocks((tok as any).tokens ?? []);
      for (const p of inner) {
        if (p instanceof Paragraph) {
          blocks.push(new Paragraph({
            children: [new TextRun({ text: "  " })].concat((p as any).options?.children ?? []),
            indent: { left: 360 },
          }));
        } else {
          blocks.push(p);
        }
      }
    } else if (tok.type === "list") {
      const ordered = !!(tok as any).ordered;
      const items: Tokens.ListItem[] = (tok as any).items ?? [];
      items.forEach((it, idx) => {
        const text = (it.tokens ?? []).map((c: any) => c.text ?? "").join(" ");
        const prefix = ordered ? `${idx + 1}. ` : "• ";
        blocks.push(new Paragraph({
          children: [new TextRun({ text: prefix }), ...inlineRuns(text)],
          indent: { left: 360 },
        }));
      });
    } else if (tok.type === "code") {
      // Render as a monospace paragraph per line so word wrap behaves.
      const lines = String((tok as any).text ?? "").split("\n");
      for (const line of lines) {
        blocks.push(new Paragraph({
          children: [new TextRun({ text: line, font: "Consolas", size: 18 })],
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F5" },
        }));
      }
    } else if (tok.type === "hr") {
      blocks.push(new Paragraph({
        children: [new TextRun({ text: "" })],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
      }));
    } else if (tok.type === "table") {
      const header: string[] = (tok as any).header?.map((h: any) => h.text ?? String(h)) ?? [];
      const rows: any[] = (tok as any).rows ?? [];
      const headerCells = header.map(h => new TableCell({
        width: { size: Math.floor(100 / Math.max(1, header.length)), type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F5" },
      }));
      const tableRows = [new TableRow({ children: headerCells, tableHeader: true })];
      for (const row of rows) {
        const cells = (row ?? []).map((cell: any) => new TableCell({
          children: [new Paragraph({ children: inlineRuns(cell.text ?? String(cell)) })],
        }));
        tableRows.push(new TableRow({ children: cells }));
      }
      blocks.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      // docx requires a paragraph after a table to anchor cursor.
      blocks.push(new Paragraph({ children: [] }));
    } else if (tok.type === "space") {
      // blank line between blocks — docx handles this implicitly
    } else if ((tok as any).text) {
      blocks.push(new Paragraph({ children: inlineRuns((tok as any).text) }));
    }
  }
  return blocks;
}

export async function markdownToDocxBuffer(markdown: string, opts?: { title?: string }): Promise<Buffer> {
  const tokens = marked.lexer(markdown ?? "");
  const blocks = tokensToBlocks(tokens);
  const doc = new Document({
    creator: "clawbot",
    title: opts?.title ?? "Document",
    styles: {
      paragraphStyles: [
        { id: "Normal", name: "Normal", run: { font: "Calibri", size: 22 } } as any,
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      children: blocks.length ? blocks : [new Paragraph({ children: [new TextRun({ text: "" })] })],
    }],
  });
  return await Packer.toBuffer(doc);
}

void AlignmentType; // keep import alive — used by docx's internal types
