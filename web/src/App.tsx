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

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/team" element={<Team />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/results" element={<ResultsIndex />} />
        <Route path="/results/:jobId" element={<Results />} />
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
        <Route path="/admin" element={<Admin />} />
        <Route path="/personas" element={<Personas />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Layout>
  );
}
