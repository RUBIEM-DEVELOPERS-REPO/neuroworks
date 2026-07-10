// Access layers — superadmin / admin / staff.
//
// Three layers, enforced server-side wherever a session token is presented:
//   superadmin — everything: money (Cost, salaries), secrets (Models,
//                Connectors, Integrations, Terminal, Governance), org admin.
//   admin      — runs the org's people + work (Users minus salaries,
//                Approvals, Tasks, Reports) but never money or secrets.
//   staff      — their own workbench: chat, tasks + reports scoped to their
//                DEPARTMENT, daily reports. No directory admin, no money.
//
// Legacy roles map in: "member"/"viewer" → staff. The seeded operator is
// migrated to superadmin on first load (an org must always have one).
//
// IMPORTANT SCOPE NOTE: this API is loopback-bound and machine callers
// (agents, connectors, the MCP bridge, cron scripts) do NOT carry a session
// token. Requests WITHOUT a token are treated as operator/machine context and
// pass — the layer gates apply to HUMANS using the web UI, which always sends
// its bearer token. The origin-guard remains the network boundary.

import type { Request, Response, NextFunction } from "express";
import { sessionUser, type PublicUser } from "./users.js";

export type AccessLayer = "superadmin" | "admin" | "staff";

const LAYER_RANK: Record<AccessLayer, number> = { staff: 0, admin: 1, superadmin: 2 };

export function layerOfRole(role: string | undefined): AccessLayer {
  if (role === "superadmin") return "superadmin";
  if (role === "admin") return "admin";
  return "staff"; // staff | member | viewer | unknown
}

export function tokenFrom(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const x = req.headers["x-session-token"];
  return typeof x === "string" ? x : undefined;
}

// Resolve the calling human (or null for token-less machine callers).
export function callerOf(req: Request): PublicUser | null {
  return sessionUser(tokenFrom(req));
}

export function callerLayer(req: Request): AccessLayer | null {
  const u = callerOf(req);
  return u ? layerOfRole(u.role) : null;
}

// Route-group gate. Token-less callers pass (machine context — see scope note
// above); a logged-in human below the floor gets a 403 naming the layer, so
// the UI can explain rather than mystify.
export function requireLayer(min: AccessLayer) {
  return (req: Request, res: Response, next: NextFunction) => {
    const layer = callerLayer(req);
    if (layer === null) return next(); // machine/operator context
    if (LAYER_RANK[layer] >= LAYER_RANK[min]) return next();
    return res.status(403).json({
      error: `this area requires ${min} access (you are ${layer})`,
      requiredLayer: min,
      yourLayer: layer,
    });
  };
}

// Strip fields a caller's layer must not see from a user record.
// Salaries are superadmin-only (money); staff also lose login telemetry.
export function redactUserFor(layer: AccessLayer | null, u: any): any {
  if (layer === null || layer === "superadmin") return u;
  const { salaryMonthly, ...rest } = u;
  if (layer === "admin") return rest;
  const { lastLoginAt, loginCount, hasPassword, ...slim } = rest;
  return slim;
}

// What each layer can see — the single source the Add-user modal's access
// preview and the Layout's nav filter both render, so the promise made at
// onboarding matches what the app actually does.
export const LAYER_BUNDLES: Record<AccessLayer, { label: string; sees: string[]; hidden: string[] }> = {
  superadmin: {
    label: "Super admin — full control",
    sees: ["Everything: all work, all monitoring", "Money: Cost page, salaries, payments approvals", "Secrets: Models, Connectors, Integrations, Terminal, Governance", "User management incl. roles"],
    hidden: [],
  },
  admin: {
    label: "Admin — runs people + work",
    sees: ["Tasks, Reports, Approvals, Schedules, Activity", "Users directory (add/edit, no salaries)", "Templates, Skills, Personas, Workforce"],
    hidden: ["Cost page & salaries", "Models / Connectors / Integrations / Terminal / Governance (secrets)"],
  },
  staff: {
    label: "Staff — their own workbench",
    sees: ["Chat + their own tasks", "Reports & tasks from THEIR department only", "Daily Reports, Calendar, Templates"],
    hidden: ["Other departments' work", "Users admin, Approvals", "All money + secrets pages"],
  },
};
