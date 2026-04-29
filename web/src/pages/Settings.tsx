import { Card } from "../components/Card";

export function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Settings</h1>
        <p className="text-sm text-cream-300/70 mt-1">Personalize NeuroWorks.</p>
      </div>

      <Card title="Profile">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-cream-300/70">Name</span><span className="text-cream-100">Arthur Magaya</span></div>
          <div className="flex justify-between"><span className="text-cream-300/70">Email</span><span className="text-cream-100">admin@rubiem.com</span></div>
          <div className="flex justify-between"><span className="text-cream-300/70">Org</span><span className="text-cream-100">RUBIEM Innovations · AIIA</span></div>
        </div>
      </Card>

      <Card title="Configuration">
        <div className="text-xs text-cream-300/70 mb-3">NeuroWorks reads its config from <span className="font-mono">clawbot/.env</span>. Edit there and restart to apply changes.</div>
        <ul className="text-xs space-y-1.5 font-mono text-cream-200">
          <li><span className="text-cream-300/50">VAULT_PATH</span> — local Obsidian vault location</li>
          <li><span className="text-cream-300/50">VAULT_REPO</span> — GitHub repo for the vault</li>
          <li><span className="text-cream-300/50">GITHUB_TOKEN</span> — fine-grained PAT for clawbot</li>
          <li><span className="text-cream-300/50">OLLAMA_MODEL</span> — local model used for summaries</li>
          <li><span className="text-cream-300/50">NEUROWORKS_PORT</span> — backend bind port</li>
        </ul>
      </Card>

      <Card title="About">
        <div className="text-xs text-cream-300/70 leading-relaxed">
          NeuroWorks is the AI workforce platform from <a className="text-violet-400 hover:text-violet-500" href="https://www.aiinstituteafrica.com" target="_blank">AIIA</a>, built and shipped by RUBIEM Innovations.
          This local console is the first surface — describe a task, delegate it, get results. Governance and audit are first-class.
        </div>
      </Card>
    </div>
  );
}
