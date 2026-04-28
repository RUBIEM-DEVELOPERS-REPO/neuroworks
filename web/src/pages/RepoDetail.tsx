import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { marked } from "marked";
import { api } from "../lib/api";
import { Card, Button } from "../components/Card";

export function RepoDetail() {
  const { owner = "", name = "" } = useParams();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [job, setJob] = useState<any>(null);
  const [running, setRunning] = useState(false);

  async function load() {
    try { setData(await api.getRepo(owner, name)); }
    catch (e: any) { setErr(e.message); }
  }

  useEffect(() => { load(); }, [owner, name]);

  async function summarize() {
    setRunning(true);
    setErr("");
    try {
      const { jobId } = await api.summarizeRepo(owner, name);
      const start = Date.now();
      const poll = setInterval(async () => {
        const j = await api.getJob(jobId);
        setJob(j);
        if (j.status === "succeeded" || j.status === "failed" || Date.now() - start > 600_000) {
          clearInterval(poll);
          setRunning(false);
          if (j.status === "succeeded") load();
        }
      }, 2000);
    } catch (e: any) { setErr(e.message); setRunning(false); }
  }

  if (err) return <div className="text-red-400 text-sm">Error: {err}</div>;
  if (!data) return <div className="text-slate-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/repos" className="text-xs text-neuro-400 hover:text-neuro-500">← repos</Link>
          <h1 className="text-2xl font-semibold text-slate-100 mt-1">{data.owner}/{data.name}</h1>
        </div>
        <Button onClick={summarize} disabled={running}>{running ? "Summarizing…" : data.summary ? "Refresh summary" : "Generate summary"}</Button>
      </div>

      {job && (
        <Card title={`Job ${job.status}`}>
          <pre className="text-[11px] font-mono text-slate-400 max-h-40 overflow-auto whitespace-pre-wrap">{job.log.join("\n")}</pre>
          {job.error && <div className="text-xs text-red-400 mt-2">{job.error}</div>}
        </Card>
      )}

      {data.summary && (
        <Card title="Summary">
          <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(data.summary) as string }} />
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Card title={`Recent commits (${data.commits.length})`}>
          {data.commits.length === 0 && <div className="text-xs text-slate-500">none in last 30 days</div>}
          <ul className="space-y-1">
            {data.commits.slice(0, 15).map((c: any) => (
              <li key={c.sha} className="text-xs">
                <span className="font-mono text-pulse-400">{c.sha}</span>{" "}
                <span className="text-slate-300">{c.message}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Open PRs (${data.prs.length})`}>
          {data.prs.length === 0 && <div className="text-xs text-slate-500">none</div>}
          <ul className="space-y-1">
            {data.prs.map((p: any) => (
              <li key={p.number} className="text-xs">
                <a href={p.url} target="_blank" className="text-neuro-400 hover:text-neuro-500">#{p.number}</a>{" "}
                <span className="text-slate-300">{p.title}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Open issues (${data.issues.length})`}>
          {data.issues.length === 0 && <div className="text-xs text-slate-500">none</div>}
          <ul className="space-y-1">
            {data.issues.map((i: any) => (
              <li key={i.number} className="text-xs">
                <a href={i.url} target="_blank" className="text-neuro-400 hover:text-neuro-500">#{i.number}</a>{" "}
                <span className="text-slate-300">{i.title}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
