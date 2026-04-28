import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Repos } from "./pages/Repos";
import { RepoDetail } from "./pages/RepoDetail";
import { Brain } from "./pages/Brain";
import { Tasks } from "./pages/Tasks";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/repos" element={<Repos />} />
        <Route path="/repos/:owner/:name" element={<RepoDetail />} />
        <Route path="/brain/*" element={<Brain />} />
        <Route path="/tasks" element={<Tasks />} />
      </Routes>
    </Layout>
  );
}
