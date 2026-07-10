import { writeVaultFile } from "./vault.js";
import { enqueueVaultCommit } from "./commit-queue.js";

export type JournalEntry = {
  kind: "job" | "persona" | "template" | "loop" | "session";
  slug: string;
  title: string;
  frontmatter?: Record<string, string | number | boolean | string[] | null | undefined>;
  body: string;
  // If true, append to a daily-rolled file under the kind folder instead of one file per slug.
  daily?: boolean;
};

const ROOT = "_neuroworks";

// Drops a markdown record into the vault under `_neuroworks/<kind>/...` so every
// material event from the local NeuroWorks server is searchable from the second
// brain. Commits are best-effort and never throw — a journal failure must not
// fail the underlying job.
export async function journal(entry: JournalEntry): Promise<{ path: string } | { skipped: string }> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    // Folder naming: pluralise kind so `job` → `jobs/`, matching _neuroworks/README.md.
    // `loop` and `session` stay singular (loop is a stream, session is conceptually scalar).
    const folder = (entry.kind === "loop" || entry.kind === "session") ? entry.kind : `${entry.kind}s`;
    const path = entry.daily
      ? `${ROOT}/${folder}/${date}.md`
      : `${ROOT}/${folder}/${date}-${entry.slug}.md`;

    const fm = {
      type: entry.kind,
      title: entry.title,
      slug: entry.slug,
      created: new Date().toISOString(),
      ...(entry.frontmatter ?? {}),
    };
    const fmText = Object.entries(fm)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${v.map(s => JSON.stringify(s)).join(", ")}]`;
        if (typeof v === "string") return `${k}: ${v.replace(/\n/g, " ").trim()}`;
        return `${k}: ${v}`;
      }).join("\n");

    if (entry.daily) {
      // Append to today's file
      const stamp = new Date().toISOString().slice(11, 19);
      const block = `\n## ${stamp} — ${entry.title}\n\n${entry.body.trim()}\n`;
      try {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const { config } = await import("../config.js");
        const full = resolve(config.vaultPath, path);
        const existing = readFileSync(full, "utf8");
        writeVaultFile(path, existing + block);
      } catch {
        // first write of the day
        const header = `---\n${fmText}\n---\n\n# ${entry.title} — ${date}\n${block}`;
        writeVaultFile(path, header);
      }
    } else {
      const md = `---\n${fmText}\n---\n\n# ${entry.title}\n\n${entry.body.trim()}\n`;
      writeVaultFile(path, md);
    }

    // Best-effort commit — debounced + serialised through the commit queue
    // so a burst of journal entries from a wave of sub-agents collapses into
    // a single git commit. Never throws.
    void enqueueVaultCommit(`neuroworks: ${entry.kind} — ${entry.slug}`);

    return { path };
  } catch (e: any) {
    return { skipped: String(e?.message ?? e) };
  }
}
