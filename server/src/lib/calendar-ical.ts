// Lightweight iCal reader — no external deps. Fetches an iCal feed URL (or
// reads a local .ics file path) and returns today's VEVENTs as { summary,
// start, end, location, attendees }. Covers the 80% case (Google Calendar
// public feed, Outlook publish link) without pulling in `node-ical` (~5 MB).

import { readFileSync, existsSync } from "node:fs";

export type CalEvent = {
  summary: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
};

function unfold(text: string): string {
  // iCal folds lines >75 chars with CRLF + space. Unfold first.
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseICalDate(raw: string): Date | null {
  // Forms: 20260530T143000Z, 20260530T143000, 20260530, TZID=...:20260530T143000
  const m = raw.match(/(\d{8})(?:T(\d{6}))?(Z)?$/);
  if (!m) return null;
  const d = m[1], t = m[2] ?? "000000", utc = !!m[3];
  const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}${utc ? "Z" : ""}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : dt;
}

export function parseIcal(source: string): CalEvent[] {
  const text = unfold(source);
  const events: CalEvent[] = [];
  const blocks = text.split(/BEGIN:VEVENT/);
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i].split(/END:VEVENT/)[0];
    const get = (key: string) => {
      const re = new RegExp(`^${key}(?:;[^:\\n]*)?:(.+)$`, "m");
      const m = b.match(re);
      return m ? m[1].trim() : undefined;
    };
    const summary = get("SUMMARY") ?? "(no title)";
    const dtstart = get("DTSTART");
    const dtend = get("DTEND");
    const location = get("LOCATION");
    const description = get("DESCRIPTION");
    if (!dtstart) continue;
    const start = parseICalDate(dtstart);
    const end = dtend ? parseICalDate(dtend) : null;
    if (!start) continue;
    events.push({
      summary,
      start: start.toISOString(),
      end: end?.toISOString(),
      location,
      description: description?.slice(0, 400),
    });
  }
  return events;
}

export async function readICalSource(source: string): Promise<CalEvent[]> {
  let raw: string;
  if (existsSync(source)) {
    raw = readFileSync(source, "utf8");
  } else if (/^https?:\/\//i.test(source)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await fetch(source, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      raw = await r.text();
    } finally { clearTimeout(timer); }
  } else {
    throw new Error("source must be an http(s) URL or a path to a local .ics file");
  }
  return parseIcal(raw);
}

export function todaysEvents(events: CalEvent[]): CalEvent[] {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return events
    .filter(e => {
      const s = new Date(e.start).getTime();
      return s >= dayStart && s < dayEnd;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
