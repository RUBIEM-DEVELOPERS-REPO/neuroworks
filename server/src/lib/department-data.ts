// Department-specific company data. A lightweight, per-department knowledge
// store that lives alongside the database connections on the Company-data page.
//
// Each entry is a named bit of data scoped to ONE department (e.g. Finance →
// "FY26 budget assumptions", HR → "leave policy summary", Sales → "ICP +
// territories"). Agents read it via the company.department_data primitive so a
// persona working a department task has its team's facts on hand without the
// operator pasting them into every prompt.
//
// Persisted at .neuroworks/department-data.json (outside the vault). This is
// reference knowledge, not credentials, so it's stored as plaintext (mode 0600)
// — the encryption layer is reserved for connection strings / auth secrets.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const CONFIG_PATH = resolve(CONFIG_DIR, "department-data.json");

const MAX_TITLE = 120;
const MAX_CONTENT = 20_000;

export type DepartmentDatum = {
  id: string;
  department: string;   // free-text department label, normalized for grouping
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

function load(): DepartmentDatum[] {
  try {
    if (!existsSync(CONFIG_PATH)) return [];
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return Array.isArray(parsed) ? (parsed as DepartmentDatum[]) : [];
  } catch { return []; }
}

function save(list: DepartmentDatum[]): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(list, null, 2), { encoding: "utf8", mode: 0o600 });
}

// Normalize a department label so "Finance", "finance", and " FINANCE " group
// together while we still show the operator's original casing back.
export function normDepartment(d: string): string {
  return String(d ?? "").trim().replace(/\s+/g, " ");
}

export function listDepartmentData(department?: string): DepartmentDatum[] {
  const list = load().sort((a, b) =>
    a.department.localeCompare(b.department) || a.title.localeCompare(b.title));
  if (!department) return list;
  const want = normDepartment(department).toLowerCase();
  return list.filter(d => d.department.toLowerCase() === want);
}

// Distinct departments that currently have data, with a count each.
export function listDepartments(): { department: string; count: number }[] {
  const byDept = new Map<string, number>();
  for (const d of load()) byDept.set(d.department, (byDept.get(d.department) ?? 0) + 1);
  return [...byDept.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => a.department.localeCompare(b.department));
}

export function addDepartmentDatum(input: { department: string; title: string; content: string }): DepartmentDatum {
  const department = normDepartment(input.department);
  const title = String(input.title ?? "").trim().slice(0, MAX_TITLE);
  const content = String(input.content ?? "").trim().slice(0, MAX_CONTENT);
  if (!department) throw new Error("department is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");
  const list = load();
  const now = new Date().toISOString();
  const datum: DepartmentDatum = { id: randomUUID(), department, title, content, createdAt: now, updatedAt: now };
  list.push(datum);
  save(list);
  return datum;
}

export function updateDepartmentDatum(id: string, patch: { department?: string; title?: string; content?: string }): DepartmentDatum | null {
  const list = load();
  const d = list.find(x => x.id === id);
  if (!d) return null;
  if (patch.department !== undefined) d.department = normDepartment(patch.department) || d.department;
  if (patch.title !== undefined) d.title = String(patch.title).trim().slice(0, MAX_TITLE) || d.title;
  if (patch.content !== undefined) d.content = String(patch.content).trim().slice(0, MAX_CONTENT) || d.content;
  d.updatedAt = new Date().toISOString();
  save(list);
  return d;
}

export function removeDepartmentDatum(id: string): boolean {
  const list = load();
  const next = list.filter(d => d.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}
