// Org-chart parser — loads `_governance/people.md`, extracts the JSON block,
// and exposes lookup / handoff helpers. The graph is what lets clawbot route
// requests laterally (peer) or up (manager) when a persona doesn't own the
// task, and what makes "Sarah's weekly digest of her reports" actually
// possible. Cached 60s like governance.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const PEOPLE_FILE_REL = "_governance/people.md";
const CACHE_TTL_MS = 60_000;

export type Person = {
  id: string;
  name: string;
  title: string;
  persona_id: string | null;
  manager: string | null;
  peers: string[];
  reports: string[];
};

type ParsedChart = {
  people: Person[];
  byId: Map<string, Person>;
  byPersonaId: Map<string, Person>;
};

let cache: { value: ParsedChart; builtAt: number; mtime: number } | null = null;

function chartPath(): string {
  return join(config.vaultPath, PEOPLE_FILE_REL);
}

export function invalidateOrgChart(): void {
  cache = null;
}

function emptyChart(): ParsedChart {
  return { people: [], byId: new Map(), byPersonaId: new Map() };
}

export function loadOrgChart(): ParsedChart {
  const p = chartPath();
  if (!existsSync(p)) {
    cache = { value: emptyChart(), builtAt: Date.now(), mtime: 0 };
    return cache.value;
  }
  const mtime = statSync(p).mtimeMs;
  if (cache && cache.mtime === mtime && Date.now() - cache.builtAt < CACHE_TTL_MS) {
    return cache.value;
  }
  let parsed: ParsedChart;
  try {
    const md = readFileSync(p, "utf8");
    // First fenced ```json block in the file is the source of truth.
    const m = md.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!m) { cache = { value: emptyChart(), builtAt: Date.now(), mtime }; return cache.value; }
    const raw = JSON.parse(m[1]);
    const list: Person[] = Array.isArray(raw?.people) ? raw.people : [];
    const byId = new Map<string, Person>();
    const byPersonaId = new Map<string, Person>();
    for (const p of list) {
      if (!p?.id) continue;
      // Normalise — make sure arrays exist so callers don't have to guard.
      const person: Person = {
        id: String(p.id),
        name: String(p.name ?? p.id),
        title: String(p.title ?? ""),
        persona_id: p.persona_id ? String(p.persona_id) : null,
        manager: p.manager ? String(p.manager) : null,
        peers: Array.isArray(p.peers) ? p.peers.map(String) : [],
        reports: Array.isArray(p.reports) ? p.reports.map(String) : [],
      };
      byId.set(person.id, person);
      if (person.persona_id) byPersonaId.set(person.persona_id, person);
    }
    parsed = { people: list, byId, byPersonaId };
  } catch {
    parsed = emptyChart();
  }
  cache = { value: parsed, builtAt: Date.now(), mtime };
  return parsed;
}

// Look up a person by `id`, `name` (case-insensitive), or `persona_id`.
// The chat / team layer doesn't know the difference between "Priya" (display
// name) and "product-manager" (persona id); we accept either.
export function lookupPerson(query: string): Person | null {
  const chart = loadOrgChart();
  const q = query.toLowerCase().trim();
  if (chart.byId.has(q)) return chart.byId.get(q)!;
  if (chart.byPersonaId.has(q)) return chart.byPersonaId.get(q)!;
  for (const p of chart.byId.values()) {
    if (p.name.toLowerCase() === q) return p;
  }
  return null;
}

// Walk `manager` upward; returns the chain as Person objects, root last.
// Stops at the first person with `manager == null` (a human, by convention)
// or after 8 hops to defend against cycles in edited charts.
export function escalationPath(idOrName: string): Person[] {
  const start = lookupPerson(idOrName);
  if (!start) return [];
  const chain: Person[] = [start];
  const chart = loadOrgChart();
  const seen = new Set([start.id]);
  let cur: Person | null = start;
  for (let hops = 0; hops < 8 && cur?.manager; hops++) {
    const next: Person | undefined = chart.byId.get(cur.manager);
    if (!next || seen.has(next.id)) break;
    chain.push(next);
    seen.add(next.id);
    cur = next;
  }
  return chain;
}

export function peersOf(idOrName: string): Person[] {
  const start = lookupPerson(idOrName);
  if (!start) return [];
  const chart = loadOrgChart();
  return start.peers.map(id => chart.byId.get(id)).filter((p): p is Person => !!p);
}

export function reportsOf(idOrName: string): Person[] {
  const start = lookupPerson(idOrName);
  if (!start) return [];
  const chart = loadOrgChart();
  return start.reports.map(id => chart.byId.get(id)).filter((p): p is Person => !!p);
}
