// Company database registry. Persists connection metadata at
// .neuroworks/data-sources.json (outside the vault, since it carries
// credentials). Lazy-imports the engine driver on first query so the server
// boots without pg/mysql2/better-sqlite3 installed — the missing-driver
// error tells the operator which `pnpm add` to run.
//
// Default contract: read-only. The SQL gate rejects anything that looks
// like a DDL/DML statement so an agent mistake can't trash production.
// The operator can flip readonly=false per source for trusted write paths.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const CONFIG_PATH = resolve(CONFIG_DIR, "data-sources.json");

export type DataSourceKind = "postgres" | "mysql" | "sqlite";

export type DataSource = {
  id: string;
  label: string;
  kind: DataSourceKind;
  connection: string;
  notes?: string;
  readonly: boolean;
  createdAt: string;
};

function load(): DataSource[] {
  try {
    if (!existsSync(CONFIG_PATH)) return [];
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as DataSource[] : [];
  } catch { return []; }
}

function save(list: DataSource[]): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(list, null, 2), "utf8");
}

export function listSources(): DataSource[] { return load(); }

export function getSource(id: string): DataSource | undefined {
  return load().find(s => s.id === id);
}

export function addSource(input: Omit<DataSource, "id" | "createdAt">): DataSource {
  const list = load();
  const ds: DataSource = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  list.push(ds);
  save(list);
  return ds;
}

export function removeSource(id: string): boolean {
  const list = load();
  const next = list.filter(s => s.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

const WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|exec|execute|merge|replace|attach|copy|vacuum|reindex)\b/i;
export function isReadOnlySql(sql: string): boolean {
  return !WRITE_KEYWORDS.test(sql);
}

export type QueryResult = { rows: any[]; columns: string[]; rowCount: number; truncated: boolean };

export async function runQuery(source: DataSource, sql: string, limit = 200): Promise<QueryResult> {
  if (source.readonly && !isReadOnlySql(sql)) {
    throw new Error("source is read-only — only SELECT / WITH / SHOW / EXPLAIN / DESCRIBE / PRAGMA allowed");
  }
  const trimmed = sql.trim().replace(/;\s*$/, "");
  switch (source.kind) {
    case "postgres": {
      let pg: any;
      try { pg = await import("pg"); }
      catch { throw new Error("postgres driver not installed — run `pnpm -C server add pg`"); }
      const Client = (pg.default ?? pg).Client;
      const client = new Client({ connectionString: source.connection });
      try {
        await client.connect();
        const r = await client.query(trimmed);
        const all = Array.isArray(r.rows) ? r.rows : [];
        const rows = all.slice(0, limit);
        const truncated = all.length > limit;
        const columns = Array.isArray(r.fields) && r.fields.length > 0
          ? r.fields.map((f: any) => f.name)
          : (rows[0] ? Object.keys(rows[0]) : []);
        return { rows, columns, rowCount: rows.length, truncated };
      } finally { try { await client.end(); } catch { /* tolerate */ } }
    }
    case "mysql": {
      let mysql: any;
      try { mysql = await import("mysql2/promise"); }
      catch { throw new Error("mysql driver not installed — run `pnpm -C server add mysql2`"); }
      const mod = mysql.default ?? mysql;
      const conn = await mod.createConnection(source.connection);
      try {
        const [rowsRaw, fields] = await conn.execute(trimmed);
        const all = Array.isArray(rowsRaw) ? rowsRaw : [];
        const rows = all.slice(0, limit);
        const truncated = all.length > limit;
        const columns = Array.isArray(fields)
          ? fields.map((f: any) => f.name)
          : (rows[0] ? Object.keys(rows[0]) : []);
        return { rows, columns, rowCount: rows.length, truncated };
      } finally { try { await conn.end(); } catch { /* tolerate */ } }
    }
    case "sqlite": {
      let mod: any;
      try { mod = await import("better-sqlite3"); }
      catch { throw new Error("sqlite driver not installed — run `pnpm -C server add better-sqlite3`"); }
      const Db = mod.default ?? mod;
      const db = new Db(source.connection, { readonly: source.readonly, fileMustExist: true });
      try {
        const stmt = db.prepare(trimmed);
        const isSelect = /^\s*(select|with|pragma|explain)\b/i.test(trimmed);
        if (isSelect) {
          const all: any[] = stmt.all();
          const rows = all.slice(0, limit);
          const truncated = all.length > limit;
          const columns = rows[0] ? Object.keys(rows[0]) : [];
          return { rows, columns, rowCount: rows.length, truncated };
        }
        const info = stmt.run();
        return { rows: [], columns: [], rowCount: info.changes ?? 0, truncated: false };
      } finally { try { db.close(); } catch { /* tolerate */ } }
    }
  }
}

export async function describeSource(source: DataSource): Promise<{ tables: { name: string; columns: { name: string; type: string }[] }[] }> {
  switch (source.kind) {
    case "postgres": {
      const r = await runQuery(source, `
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY table_schema, table_name, ordinal_position
      `, 10000);
      const byTable = new Map<string, { name: string; type: string }[]>();
      for (const row of r.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!byTable.has(key)) byTable.set(key, []);
        byTable.get(key)!.push({ name: String(row.column_name), type: String(row.data_type) });
      }
      return { tables: [...byTable.entries()].map(([name, columns]) => ({ name, columns })) };
    }
    case "mysql": {
      const r = await runQuery(source, `
        SELECT table_schema, table_name, column_name, column_type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys')
        ORDER BY table_schema, table_name, ordinal_position
      `, 10000);
      const byTable = new Map<string, { name: string; type: string }[]>();
      for (const row of r.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!byTable.has(key)) byTable.set(key, []);
        byTable.get(key)!.push({ name: String(row.column_name), type: String(row.column_type) });
      }
      return { tables: [...byTable.entries()].map(([name, columns]) => ({ name, columns })) };
    }
    case "sqlite": {
      const r = await runQuery(source, `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`, 1000);
      const tables: { name: string; columns: { name: string; type: string }[] }[] = [];
      for (const row of r.rows) {
        const tname = String(row.name);
        if (tname.startsWith("sqlite_")) continue;
        const cols = await runQuery(source, `PRAGMA table_info("${tname.replace(/"/g, '""')}")`, 1000);
        tables.push({
          name: tname,
          columns: cols.rows.map((c: any) => ({ name: String(c.name), type: String(c.type) })),
        });
      }
      return { tables };
    }
  }
}

export function redactConnection(conn: string, kind: DataSourceKind): string {
  if (kind === "sqlite") return conn;
  return conn.replace(/(:\/\/[^:@]+:)([^@]+)(@)/, "$1***$3");
}
