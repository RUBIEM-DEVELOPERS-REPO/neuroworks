import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Tasks } from "./pages/Tasks";
import { Templates } from "./pages/Templates";
import { Approvals } from "./pages/Approvals";
import { Activity } from "./pages/Activity";
import { Knowledge } from "./pages/Knowledge";
import { Admin } from "./pages/Admin";
import { Settings } from "./pages/Settings";
import { Chat } from "./pages/Chat";
import { Personas } from "./pages/Personas";
import { Team } from "./pages/Team";
import { Results, ResultsIndex } from "./pages/Results";
import { Skills } from "./pages/Skills";
import { Schedules } from "./pages/Schedules";
import { Governance } from "./pages/Governance";
import { CalendarPage } from "./pages/CalendarPage";
import { DocEditor } from "./pages/DocEditor";
import { DataSources } from "./pages/DataSources";
import { Terminal } from "./pages/Terminal";
import { Integrations } from "./pages/Integrations";
import { Connectors } from "./pages/Connectors";
import { Payments } from "./pages/Payments";
import { Presets } from "./pages/Presets";
import { Users } from "./pages/Users";
import { Workforce } from "./pages/Workforce";
import { Departments } from "./pages/Departments";
import { KnowledgePacks } from "./pages/KnowledgePacks";
import { DataPipeline } from "./pages/DataPipeline";
import { Models } from "./pages/Models";
import { Quality } from "./pages/Quality";
import { Cost } from "./pages/Cost";
import { AuditLog } from "./pages/AuditLog";
import { SkillForge } from "./pages/SkillForge";
import { Orchestrate } from "./pages/Orchestrate";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { DailyReports } from "./pages/DailyReports";

function AppShell() {
  return (
    <Layout>
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
