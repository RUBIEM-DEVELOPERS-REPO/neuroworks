import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Layout } from "./components/Layout";
import { Skeleton } from "./components/Card";

// Route-level code splitting. Login/Onboarding load eagerly (they're the
// first thing an unauthenticated visitor sees); everything behind the app
// shell is fetched on demand — a user opening the app to check one page
// shouldn't download all 30+ pages' worth of JS up front. Each page becomes
// its own fingerprinted chunk (see vite.config.ts's manualChunks for the
// vendor split that pairs with this), so a change to one page doesn't bust
// the cache for the others either.
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
const Dashboard = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.Dashboard })));
const Tasks = lazy(() => import("./pages/Tasks").then(m => ({ default: m.Tasks })));
const Templates = lazy(() => import("./pages/Templates").then(m => ({ default: m.Templates })));
const Approvals = lazy(() => import("./pages/Approvals").then(m => ({ default: m.Approvals })));
const Activity = lazy(() => import("./pages/Activity").then(m => ({ default: m.Activity })));
const Knowledge = lazy(() => import("./pages/Knowledge").then(m => ({ default: m.Knowledge })));
const Admin = lazy(() => import("./pages/Admin").then(m => ({ default: m.Admin })));
const Settings = lazy(() => import("./pages/Settings").then(m => ({ default: m.Settings })));
const Chat = lazy(() => import("./pages/Chat").then(m => ({ default: m.Chat })));
const Personas = lazy(() => import("./pages/Personas").then(m => ({ default: m.Personas })));
const Team = lazy(() => import("./pages/Team").then(m => ({ default: m.Team })));
const ResultsIndex = lazy(() => import("./pages/Results").then(m => ({ default: m.ResultsIndex })));
const Results = lazy(() => import("./pages/Results").then(m => ({ default: m.Results })));
const Skills = lazy(() => import("./pages/Skills").then(m => ({ default: m.Skills })));
const Schedules = lazy(() => import("./pages/Schedules").then(m => ({ default: m.Schedules })));
const Governance = lazy(() => import("./pages/Governance").then(m => ({ default: m.Governance })));
const CalendarPage = lazy(() => import("./pages/CalendarPage").then(m => ({ default: m.CalendarPage })));
const DocEditor = lazy(() => import("./pages/DocEditor").then(m => ({ default: m.DocEditor })));
const DataSources = lazy(() => import("./pages/DataSources").then(m => ({ default: m.DataSources })));
const Terminal = lazy(() => import("./pages/Terminal").then(m => ({ default: m.Terminal })));
const Integrations = lazy(() => import("./pages/Integrations").then(m => ({ default: m.Integrations })));
const Connectors = lazy(() => import("./pages/Connectors").then(m => ({ default: m.Connectors })));
const Payments = lazy(() => import("./pages/Payments").then(m => ({ default: m.Payments })));
const Presets = lazy(() => import("./pages/Presets").then(m => ({ default: m.Presets })));
const Users = lazy(() => import("./pages/Users").then(m => ({ default: m.Users })));
const Workforce = lazy(() => import("./pages/Workforce").then(m => ({ default: m.Workforce })));
const Departments = lazy(() => import("./pages/Departments").then(m => ({ default: m.Departments })));
const KnowledgePacks = lazy(() => import("./pages/KnowledgePacks").then(m => ({ default: m.KnowledgePacks })));
const DataPipeline = lazy(() => import("./pages/DataPipeline").then(m => ({ default: m.DataPipeline })));
const Models = lazy(() => import("./pages/Models").then(m => ({ default: m.Models })));
const Quality = lazy(() => import("./pages/Quality").then(m => ({ default: m.Quality })));
const Cost = lazy(() => import("./pages/Cost").then(m => ({ default: m.Cost })));
const AuditLog = lazy(() => import("./pages/AuditLog").then(m => ({ default: m.AuditLog })));
const SkillForge = lazy(() => import("./pages/SkillForge").then(m => ({ default: m.SkillForge })));
const Orchestrate = lazy(() => import("./pages/Orchestrate").then(m => ({ default: m.Orchestrate })));
const DailyReports = lazy(() => import("./pages/DailyReports").then(m => ({ default: m.DailyReports })));

// Lightweight, layout-shift-free placeholder while a route chunk downloads —
// on a warm cache this never has time to paint; on a cold load it beats a
// blank white flash.
// Shown only in the gap between a route's chunk being requested and resolving.
// With hover-prefetch (routePreload.ts) that gap is usually zero — this exists
// for a cold click on a not-yet-warmed route. Fades in (nw-fade-up) so a
// sub-frame flash doesn't strobe, and the skeletons shimmer (`.skeleton`).
function RouteFallback() {
  return (
    <div className="space-y-3 nw-fade-up">
      <div className="flex items-center gap-2 text-xs text-cream-300/50">
        <span className="nw-thinking-dots" aria-hidden><span /><span /><span /></span>
        Loading…
      </div>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function AppShell() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/team" element={<Team />} />
        <Route path="/presets" element={<Presets />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/results" element={<ResultsIndex />} />
        <Route path="/results/:jobId" element={<Results />} />
        <Route path="/daily-reports" element={<DailyReports />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/schedules" element={<Schedules />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/edit" element={<DocEditor />} />
        <Route path="/edit/*" element={<DocEditor />} />
        <Route path="/governance" element={<Governance />} />
        <Route path="/knowledge/*" element={<Knowledge />} />
        <Route path="/data-sources" element={<DataSources />} />
        <Route path="/terminal" element={<Terminal />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/connectors" element={<Connectors />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/users" element={<Users />} />
        <Route path="/workforce" element={<Workforce />} />
        <Route path="/departments" element={<Departments />} />
        <Route path="/knowledge-packs" element={<KnowledgePacks />} />
        <Route path="/data-pipeline" element={<DataPipeline />} />
        <Route path="/models" element={<Models />} />
        <Route path="/quality" element={<Quality />} />
        <Route path="/cost" element={<Cost />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/skill-forge" element={<SkillForge />} />
        <Route path="/orchestrate" element={<Orchestrate />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/personas" element={<Personas />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}

export default function App() {
  // /login and /onboarding render bare (no sidebar/header); everything else inside the app shell.
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}
