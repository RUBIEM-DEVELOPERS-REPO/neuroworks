// Route chunk prefetching. Every page is React.lazy'd (App.tsx), so its JS
// chunk isn't fetched until the route mounts — the first click on a nav item
// pays a network round-trip before anything renders. This maps each route's
// path prefix to its dynamic import() thunk so the Layout can warm the chunk
// on nav-hover (and a couple of high-traffic routes on idle after first
// paint). import() is memoized by the bundler — calling a thunk twice is free,
// the second call resolves from cache — so preloading is pure upside: if the
// user clicks, the chunk is already in flight or done; if they don't, one
// cached fetch is the only cost.
//
// Keys are matched by longest-prefix against location.pathname, so
// "/results/:id" preloads via the "/results" entry.

type Thunk = () => Promise<unknown>;

const preloaders: Record<string, Thunk> = {
  "/dashboard": () => import("../pages/Dashboard"),
  "/chat": () => import("../pages/Chat"),
  "/team": () => import("../pages/Team"),
  "/presets": () => import("../pages/Presets"),
  "/tasks": () => import("../pages/Tasks"),
  "/calendar": () => import("../pages/CalendarPage"),
  "/results": () => import("../pages/Results"),
  "/daily-reports": () => import("../pages/DailyReports"),
  "/edit": () => import("../pages/DocEditor"),
  "/approvals": () => import("../pages/Approvals"),
  "/activity": () => import("../pages/Activity"),
  "/schedules": () => import("../pages/Schedules"),
  "/templates": () => import("../pages/Templates"),
  "/skills": () => import("../pages/Skills"),
  "/personas": () => import("../pages/Personas"),
  "/workforce": () => import("../pages/Workforce"),
  "/departments": () => import("../pages/Departments"),
  "/knowledge-packs": () => import("../pages/KnowledgePacks"),
  "/quality": () => import("../pages/Quality"),
  "/cost": () => import("../pages/Cost"),
  "/audit": () => import("../pages/AuditLog"),
  "/skill-forge": () => import("../pages/SkillForge"),
  "/orchestrate": () => import("../pages/Orchestrate"),
  "/knowledge": () => import("../pages/Knowledge"),
  "/users": () => import("../pages/Users"),
  "/data-sources": () => import("../pages/DataSources"),
  "/data-pipeline": () => import("../pages/DataPipeline"),
  "/models": () => import("../pages/Models"),
  "/connectors": () => import("../pages/Connectors"),
  "/integrations": () => import("../pages/Integrations"),
  "/payments": () => import("../pages/Payments"),
  "/terminal": () => import("../pages/Terminal"),
  "/governance": () => import("../pages/Governance"),
  "/admin": () => import("../pages/Admin"),
  "/settings": () => import("../pages/Settings"),
};

const warmed = new Set<string>();

/** Warm the chunk for a route path (idempotent — each chunk fetched at most once). */
export function preloadRoute(path: string): void {
  // Longest-prefix match so nested paths (/results/123) hit their parent entry.
  let best = "";
  for (const key of Object.keys(preloaders)) {
    if (path === key || path.startsWith(key + "/")) {
      if (key.length > best.length) best = key;
    }
  }
  if (!best || warmed.has(best)) return;
  warmed.add(best);
  try { void preloaders[best](); } catch { warmed.delete(best); }
}

/** After first paint, prefetch the routes a user almost always visits next. */
export function preloadLikelyRoutes(): void {
  const run = () => { preloadRoute("/chat"); preloadRoute("/tasks"); preloadRoute("/results"); };
  if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 1500);
  }
}
