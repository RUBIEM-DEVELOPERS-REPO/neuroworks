import { useEffect, useState } from "react";
import { Plug, Plus, Trash2, CheckCircle2, AlertTriangle, Loader2, ExternalLink, X, Check } from "lucide-react";
import { api, type IntegrationProvider, type IntegrationConnection } from "../lib/api";
import { Card, Button, showToast } from "../components/Card";

// Health dot — the at-a-glance "connected & working" signal. Green = last test
// passed, red = last test failed, amber pulse = never tested yet.
function HealthDot({ conn }: { conn: IntegrationConnection }) {
  const t = conn.lastTest;
  const cls = !t ? "bg-amber-400/80 animate-pulse" : t.ok ? "bg-leaf-500" : "bg-coral-500";
  const title = !t ? "Not tested yet" : t.ok ? `Working — ${t.detail}` : `Failing — ${t.detail}`;
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} title={title} />;
}

function relTime(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Integrations — the user connects external services (messaging, social,
// productivity, dev tools) so agents can act on them. Secrets are encrypted
// server-side and never returned here. Agents reach connected services via the
// integration.list / slack.post / telegram.send / discord.post primitives.

const CATEGORY_LABELS: Record<string, string> = {
  messaging: "Messaging",
  social: "Social",
  productivity: "Productivity",
  dev: "Dev & data",
};
const CATEGORY_ORDER = ["messaging", "productivity", "social", "dev"];

export function Integrations() {
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [connecting, setConnecting] = useState<IntegrationProvider | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  // Payment gateways are env-configured (not secret-entry connections), but
  // they belong on this page too — one place to see everything agents can act
  // on. Read-only status cards linking through to /payments.
  const [gateways, setGateways] = useState<{ name: string; enabled: boolean; detail: string }[]>([]);

  async function refresh() {
    try { const c = await api.integrationsCatalog(); setProviders(c.providers); } catch {}
    try { const l = await api.listIntegrations(); setConnections(l.connections); } catch {}
    try {
      const [stripe, paynow] = await Promise.all([
        api.paymentStatus().catch(() => null),
        api.paynowStatus().catch(() => null),
      ]);
      setGateways([
        { name: "Stripe", enabled: !!stripe?.enabled, detail: stripe?.enabled ? `${(stripe as any).currency?.toUpperCase?.() ?? ""} · payment links + subscriptions` : "STRIPE_SECRET_KEY not set" },
        { name: "Paynow (Zimbabwe)", enabled: !!paynow?.enabled, detail: paynow?.enabled ? `integration ${paynow.integrationId} · EcoCash, OneMoney, cards` : "PAYNOW_INTEGRATION_ID/KEY not set" },
      ]);
    } catch { /* gateways card is best-effort */ }
  }
  useEffect(() => { void refresh(); }, []);

  async function test(id: string) {
    setTesting(id);
    try {
      const r = await api.testIntegration(id);
      showToast(r.ok ? `✓ ${r.detail}` : `Test failed: ${r.detail}`, r.ok ? "success" : "error");
      await refresh(); // pull the persisted health signal back
    } catch (e: any) {
      showToast(`Test error: ${e?.message ?? e}`, "error");
    } finally { setTesting(null); }
  }

  async function testAll() {
    setTestingAll(true);
    try {
      const { results } = await api.testAllIntegrations();
      const ok = results.filter(r => r.ok).length;
      const bad = results.length - ok;
      showToast(bad === 0 ? `All ${ok} integration${ok === 1 ? "" : "s"} working ✓` : `${ok} working, ${bad} failing`, bad === 0 ? "success" : "error");
      await refresh();
    } catch (e: any) {
      showToast(`Test error: ${e?.message ?? e}`, "error");
    } finally { setTestingAll(false); }
  }
  async function remove(id: string, label: string) {
    if (!confirm(`Disconnect "${label}"? Agents using it will stop being able to.`)) return;
    try { await api.removeIntegration(id); showToast("Disconnected", "success"); refresh(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
  }

  const connByProvider = (pid: string) => connections.filter(c => c.providerId === pid);
  const grouped = CATEGORY_ORDER
    .map(cat => ({ cat, items: providers.filter(p => p.category === cat) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><Plug size={24} /> Integrations</h1>
        <p className="text-sm text-cream-300/70 mt-1">
          Connect your tools so agents can act on them — post to <span className="font-mono">Slack</span>/<span className="font-mono">Telegram</span>, read <span className="font-mono">Notion</span>/<span className="font-mono">GitHub</span>, and more.
          Secrets are <span className="text-cream-200">encrypted at rest</span> and never leave the server.
        </p>
      </div>

      {gateways.length > 0 && (
        <Card title="Payment gateways">
          <div className="space-y-2">
            {gateways.map(g => (
              <div key={g.name} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-ink-950/50 border border-ink-800">
                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${g.enabled ? "bg-leaf-500" : "bg-cream-300/30"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-cream-100">{g.name}</div>
                  <div className="text-[11px] text-cream-300/50">{g.enabled ? `Connected · ${g.detail}` : g.detail}</div>
                </div>
                <a href="/payments" className="text-[12px] text-violet-400 hover:text-violet-300 inline-flex items-center gap-1">Manage <ExternalLink size={12} /></a>
              </div>
            ))}
          </div>
        </Card>
      )}

      {connections.length > 0 && (
        <Card
          title={`Connected (${connections.length})`}
          action={
            <Button variant="subtle" onClick={testAll} disabled={testingAll}>
              {testingAll ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Test all
            </Button>
          }
        >
          <div className="space-y-2">
            {connections.map(c => (
              <div key={c.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-ink-950/50 border border-ink-800">
                <div className="relative">
                  <div className="w-8 h-8 rounded-md bg-violet-500/15 grid place-items-center text-violet-300 text-xs font-semibold">{c.providerName.slice(0, 2)}</div>
                  <span className="absolute -bottom-0.5 -right-0.5 ring-2 ring-ink-950 rounded-full"><HealthDot conn={c} /></span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-cream-100 truncate">{c.label} <span className="text-cream-300/40">· {c.providerName}</span></div>
                  <div className="text-[11px] text-cream-300/50">
                    {c.lastTest
                      ? <span className={c.lastTest.ok ? "text-leaf-400/90" : "text-coral-400/90"}>{c.lastTest.ok ? "Working" : "Failing"} · {c.lastTest.detail} · {relTime(c.lastTest.at)}</span>
                      : <span className="text-amber-300/80">Not tested yet</span>}
                  </div>
                </div>
                <Button variant="subtle" onClick={() => test(c.id)} disabled={testing === c.id}>
                  {testing === c.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Test
                </Button>
                <button type="button" onClick={() => remove(c.id, c.label)} className="text-cream-300/50 hover:text-coral-400 p-1.5" title="Disconnect"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {grouped.map(({ cat, items }) => (
        <div key={cat}>
          <div className="text-[11px] uppercase tracking-wider text-cream-300/40 mb-2 mt-1">{CATEGORY_LABELS[cat] ?? cat}</div>
          <div className="grid grid-cols-2 gap-3">
            {items.map(p => {
              const conns = connByProvider(p.id);
              const isConnected = conns.length > 0;
              // Provider health = worst of its connections (red if any failing,
              // amber if any untested, green only when all tested-and-working).
              const anyFail = conns.some(c => c.lastTest && !c.lastTest.ok);
              const anyUntested = conns.some(c => !c.lastTest);
              return (
                <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border bg-ink-900/40 ${isConnected ? "border-leaf-500/30" : "border-ink-800"}`}>
                  <div className="w-9 h-9 rounded-lg bg-ink-800 grid place-items-center text-cream-200 text-xs font-semibold shrink-0">{p.name.slice(0, 2)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-cream-100 flex items-center gap-1.5">
                      {p.name}
                      {isConnected && (
                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${anyFail ? "text-coral-400 bg-coral-500/10" : anyUntested ? "text-amber-300/90 bg-amber-400/10" : "text-leaf-400 bg-leaf-500/10"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${anyFail ? "bg-coral-500" : anyUntested ? "bg-amber-400/80 animate-pulse" : "bg-leaf-500"}`} />
                          {conns.length > 1 ? `${conns.length} connected` : "connected"}
                        </span>
                      )}
                      {p.auth === "oauth" && <span className="text-[10px] text-amber-300/80 bg-amber-400/10 px-1.5 py-0.5 rounded-full">token</span>}
                    </div>
                    {p.note && <div className="text-[10px] text-cream-300/40 truncate">{p.note}</div>}
                  </div>
                  {isConnected ? (
                    <Button variant="subtle" onClick={() => setConnecting(p)} className="!text-leaf-400 !border-leaf-500/30">
                      <Check size={13} /> Connected
                    </Button>
                  ) : (
                    <Button variant="subtle" onClick={() => setConnecting(p)}><Plus size={13} /> Connect</Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {connecting && (
        <ConnectModal
          provider={connecting}
          onClose={() => setConnecting(null)}
          onConnected={() => { setConnecting(null); refresh(); }}
        />
      )}
    </div>
  );
}

function ConnectModal({ provider, onClose, onConnected }: { provider: IntegrationProvider; onClose: () => void; onConnected: () => void }) {
  const [label, setLabel] = useState(provider.name);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null); setSaving(true);
    try {
      const { connection } = await api.addIntegration(provider.id, label, values);
      // Immediately verify the credentials so the card shows a real
      // "connected & working" signal instead of an unverified "connected".
      let verdict: { ok: boolean; detail: string } | null = null;
      try { verdict = await api.testIntegration(connection.id); } catch { /* tested on next manual run */ }
      if (verdict) {
        showToast(verdict.ok ? `${provider.name} connected & working ✓` : `${provider.name} connected, but the test failed: ${verdict.detail}`, verdict.ok ? "success" : "error");
      } else {
        showToast(`${provider.name} connected`, "success");
      }
      onConnected();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-ink-900 border border-ink-700 rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg text-cream-50 font-medium">Connect {provider.name}</h2>
          <button onClick={onClose} className="text-cream-300/50 hover:text-cream-100"><X size={18} /></button>
        </div>
        {provider.note && <div className="text-[11px] text-amber-300/80 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">{provider.note}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-cream-300/70 mb-1">Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className="w-full bg-ink-950 border border-ink-800 text-sm text-cream-100 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500/60" />
          </div>
          {provider.fields.map(f => (
            <div key={f.name}>
              <label className="block text-[11px] text-cream-300/70 mb-1">{f.label}{f.required && <span className="text-coral-400"> *</span>}</label>
              <input
                type={f.type === "password" ? "password" : "text"}
                value={values[f.name] ?? ""}
                onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                autoComplete="off" spellCheck={false}
                className="w-full bg-ink-950 border border-ink-800 text-sm text-cream-100 rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-violet-500/60 placeholder:text-cream-300/30"
              />
            </div>
          ))}
        </div>
        {err && <div className="text-[12px] text-coral-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {err}</div>}
        <div className="flex items-center justify-between pt-1">
          {provider.docsUrl
            ? <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-400 hover:text-violet-300 inline-flex items-center gap-1">Where do I get this? <ExternalLink size={11} /></a>
            : <span />}
          <Button onClick={submit} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Connect</Button>
        </div>
      </div>
    </div>
  );
}
