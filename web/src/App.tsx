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

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/knowledge/*" element={<Knowledge />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/personas" element={<Personas />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Layout>
  );
}
