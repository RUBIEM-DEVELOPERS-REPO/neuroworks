import { useEffect, useState } from "react";
import { Users as UsersIcon, Plus, Trash2, KeyRound, Loader2, X, AlertTriangle, ShieldCheck, Clock } from "lucide-react";
import { api, type User, type UserRole, type UserStatus, type LoginEvent, type WorkMode } from "../lib/api";
import { Card, Button, showToast } from "../components/Card";

// Users page — the admin directory of the org's people. Shows who's part of the
// org (name, email, role, department), their login activity, and lets the admin
// add/edit users + set passwords. The agent reads the same directory via the
// users.list / users.lookup primitives.

function relTime(iso?: string): string {
  if (!iso) return "never";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const ROLE_CLASS: Record<UserRole, string> = {
  superadmin: "text-flame-300 bg-flame-500/15",
  admin: "text-violet-300 bg-violet-500/15",
  staff: "text-sky-300 bg-sky-500/15",
  member: "text-cream-200 bg-ink-800",
  viewer: "text-cream-300/70 bg-ink-800",
};
const WORKMODE_CLASS: Record<WorkMode, string> = {
  agent: "text-violet-300 bg-violet-500/15",
  hybrid: "text-sky-300 bg-sky-500/15",
  human: "text-cream-200 bg-ink-800",
};
const STATUS_CLASS: Record<UserStatus, string> = {
  pending: "text-amber-300 bg-amber-400/15",
  active: "text-leaf-400 bg-leaf-500/10",
  invited: "text-amber-300 bg-amber-400/10",
  disabled: "text-coral-400 bg-coral-500/10",
};

export function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    try { setUsers((await api.listUsers()).users); } catch {}
    try { setEvents((await api.loginEvents(25)).events); } catch {}
  }
  useEffect(() => {
    void refresh();
    api.session().then(r => setMe(r.user)).catch(() => {});
  }, []);

  const isAdmin = me?.role === "admin" || me?.role === "superadmin" || !me;
  // Money (salaries) is superadmin-territory; a session-less loopback
  // operator counts as superadmin (machine context — server does the same).
  const isSuper = me?.role === "superadmin" || !me;

  async function changeRole(u: User, role: UserRole) {
    try { await api.updateUser(u.id, { role }); showToast(`${u.name} → ${role}`, "success"); refresh(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
  }
  async function changeStatus(u: User, status: UserStatus) {
    try { await api.updateUser(u.id, { status }); refresh(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
  }
  async function changeWorkMode(u: User, workMode: WorkMode) {
    try { await api.updateUser(u.id, { workMode }); showToast(`${u.name} → ${workMode} work mode`, "success"); refresh(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
  }
  async function setSalary(u: User) {
    const raw = window.prompt(`Monthly salary for ${u.name} (ZAR, blank to clear):`, u.salaryMonthly ? String(u.salaryMonthly) : "");
    if (raw == null) return;
    const v = raw.trim() === "" ? null : Number(raw.replace(/[^\d.]/g, ""));
    if (v !== null && (!Number.isFinite(v) || v <= 0)) { showToast("Enter a positive number", "error"); return; }
    try { await api.updateUser(u.id, { salaryMonthly: v }); showToast(v === null ? "Salary cleared" : `Salary set — R${v.toLocaleString()}/mo`, "success"); refresh(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
  }
  async function setPassword(u: User) {
    const pw = window.prompt(`Set a password for ${u.name} (min 4 chars):`);
    if (pw == null) return;
    try { await api.setUserPassword(u.id, pw); showToast(`Password set for ${u.name}`, "success"); refresh(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
  }
  async function remove(u: User) {
    if (!confirm(`Remove ${u.name} (${u.email}) from the org? This deletes their account.`)) return;
    try { await api.deleteUser(u.id); showToast("User removed", "success"); refresh(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><UsersIcon size={24} /> Users</h1>
          <p className="text-sm text-cream-300/70 mt-1">
            The people in your organization — who's part of the org, their role, and their login activity. The agent can
            look anyone up (name, email, department) via <span className="font-mono">users.list</span> / <span className="font-mono">users.lookup</span>.
          </p>
        </div>
        {isAdmin && <Button onClick={() => setAdding(true)}><Plus size={14} /> Add user</Button>}
      </div>

      {!isAdmin && (
        <div className="text-[12px] text-amber-300/90 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <ShieldCheck size={14} /> You're viewing the directory. Editing users requires an admin account{me ? "" : " — sign in first"}.
        </div>
      )}

      <Card title={`Directory (${users.length})`}>
        <div className="space-y-1.5">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-ink-950/50 border border-ink-800">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500/40 to-coral-500/40 grid place-items-center text-[12px] font-semibold text-cream-50 shrink-0">
                {u.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-cream-100 flex items-center gap-2 flex-wrap">
                  {u.name}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_CLASS[u.role]}`}>{u.role}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_CLASS[u.status]}`}>{u.status}</span>
                  {!u.hasPassword && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-300/90">no password</span>}
                  {u.workMode && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${WORKMODE_CLASS[u.workMode]}`}>{u.workMode === "hybrid" ? "hybrid (agent + human)" : u.workMode}</span>}
                  {isSuper && (u.salaryMonthly ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-leaf-500/10 text-leaf-400">R{u.salaryMonthly.toLocaleString()}/mo</span> : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-800 text-cream-300/50">no salary set</span>)}
                </div>
                <div className="text-[11px] text-cream-300/50 truncate">
                  {u.email}{u.title ? ` · ${u.title}` : ""}{u.department ? ` · ${u.department}` : ""} · last login {relTime(u.lastLoginAt)} · {u.loginCount}×
                </div>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <select value={u.role} onChange={e => changeRole(u, e.target.value as UserRole)} className="bg-ink-950 border border-ink-800 text-[11px] text-cream-200 rounded px-1.5 py-1">
                    {isSuper && <option value="superadmin">super admin</option>}
                    <option value="admin">admin</option><option value="staff">staff</option>
                    {(u.role === "member" || u.role === "viewer") && <><option value="member">member (legacy)</option><option value="viewer">viewer (legacy)</option></>}
                  </select>
                  <select value={u.status} onChange={e => changeStatus(u, e.target.value as UserStatus)} className="bg-ink-950 border border-ink-800 text-[11px] text-cream-200 rounded px-1.5 py-1">
                    <option value="active">active</option><option value="invited">invited</option><option value="disabled">disabled</option>
                  </select>
                  <select value={u.workMode ?? ""} onChange={e => changeWorkMode(u, e.target.value as WorkMode)} className="bg-ink-950 border border-ink-800 text-[11px] text-cream-200 rounded px-1.5 py-1" title="Work mode — how much of this role the system performs">
                    <option value="" disabled>work mode…</option>
                    <option value="human">human</option><option value="hybrid">hybrid</option><option value="agent">agent</option>
                  </select>
                  {isSuper && <button type="button" onClick={() => setSalary(u)} className="text-cream-300/50 hover:text-leaf-400 p-1.5 text-[11px] font-semibold" title="Set monthly salary (feeds the Cost page)">R</button>}
                  <button type="button" onClick={() => setPassword(u)} className="text-cream-300/50 hover:text-cream-100 p-1.5" title="Set password"><KeyRound size={15} /></button>
                  <button type="button" onClick={() => remove(u)} className="text-cream-300/50 hover:text-coral-400 p-1.5" title="Remove"><Trash2 size={15} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Login activity" action={<span className="text-[11px] text-cream-300/50">{events.length} recent</span>}>
        {events.length === 0 ? (
          <div className="text-sm text-cream-300/60">No logins recorded yet.</div>
        ) : (
          <div className="space-y-1">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-ink-950/50 text-[12px]">
                <Clock size={13} className="text-cream-300/40 shrink-0" />
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ev.ok ? "bg-leaf-500" : "bg-coral-500"}`} />
                <span className="text-cream-200">{ev.name ?? ev.email}</span>
                <span className="text-cream-300/50 flex-1 truncate">{ev.ok ? "signed in" : `failed — ${ev.reason ?? "denied"}`}</span>
                <span className="text-cream-300/40">{new Date(ev.at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {adding && <AddUserModal isSuper={isSuper} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

const FIELD = "w-full bg-ink-950 border border-ink-800 text-sm text-cream-100 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500/60 placeholder:text-cream-300/30";

function AddUserModal({ isSuper, onClose, onAdded }: { isSuper: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [roleTouched, setRoleTouched] = useState(false);
  const [layers, setLayers] = useState<Record<string, { label: string; sees: string[]; hidden: string[] }> | null>(null);
  useEffect(() => { api.accessLayers().then(r => setLayers(r.layers)).catch(() => {}); }, []);
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [password, setPassword] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>("human");
  const [salary, setSalary] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null); setSaving(true);
    try {
      const salaryMonthly = salary.trim() ? Number(salary.replace(/[^\d.]/g, "")) : undefined;
      await api.addUser({ name, email, role, title: title || undefined, department: department || undefined, password: password || undefined, workMode, salaryMonthly: Number.isFinite(salaryMonthly as number) && (salaryMonthly as number) > 0 ? salaryMonthly : undefined });
      showToast(`Added ${name}`, "success");
      onAdded();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-ink-900 border border-ink-700 rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg text-cream-50 font-medium">Add user</h2>
          <button onClick={onClose} className="text-cream-300/50 hover:text-cream-100"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[11px] text-cream-300/70 mb-1">Name *</label><input value={name} onChange={e => setName(e.target.value)} className={FIELD} /></div>
            <div><label className="block text-[11px] text-cream-300/70 mb-1">Access layer</label>
              <div className="flex gap-1.5">
                {(["staff", "admin", ...(isSuper ? ["superadmin"] as const : [])] as UserRole[]).map(r => (
                  <button key={r} type="button" onClick={() => { setRole(r); setRoleTouched(true); }}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] ${role === r ? "border-violet-500/70 bg-violet-500/10 text-cream-100" : "border-ink-800 bg-ink-950 text-cream-300 hover:border-ink-600"}`}>
                    {r === "superadmin" ? "super admin" : r}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div><label className="block text-[11px] text-cream-300/70 mb-1">Email *</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="person@rubiem.com" className={`${FIELD} font-mono`} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[11px] text-cream-300/70 mb-1">Title</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Sales Lead" className={FIELD} /></div>
            <div><label className="block text-[11px] text-cream-300/70 mb-1">Department</label><input value={department} onChange={e => {
              setDepartment(e.target.value);
              // Position drives the proposed access layer until the admin
              // explicitly picks one: executive/leadership → admin, else staff.
              if (!roleTouched) setRole(/executive|leadership|management|director/i.test(e.target.value) ? "admin" : "staff");
            }} placeholder="Revenue" className={FIELD} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[11px] text-cream-300/70 mb-1">Work mode</label>
              <select value={workMode} onChange={e => setWorkMode(e.target.value as WorkMode)} className={FIELD}>
                <option value="human">human — person does the work</option>
                <option value="hybrid">hybrid — agent + person</option>
                <option value="agent">agent — fully autonomous</option>
              </select>
            </div>
            <div><label className="block text-[11px] text-cream-300/70 mb-1">Salary (ZAR/month, optional)</label><input value={salary} onChange={e => setSalary(e.target.value)} placeholder="45000" className={FIELD} inputMode="numeric" /></div>
          </div>
          {layers && layers[role === "member" || role === "viewer" ? "staff" : role] && (() => {
            const b = layers[role === "member" || role === "viewer" ? "staff" : role];
            return (
              <div className="rounded-lg bg-ink-950 border border-ink-800 px-3 py-2 text-[11px] space-y-1">
                <div className="text-cream-200 font-medium">{b.label}</div>
                {b.sees.map((x, i) => <div key={i} className="text-leaf-400/90">✓ {x}</div>)}
                {b.hidden.map((x, i) => <div key={i} className="text-cream-300/50">✕ {x}</div>)}
              </div>
            );
          })()}
          <div><label className="block text-[11px] text-cream-300/70 mb-1">Password (optional — they can set it on first sign-in)</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className={`${FIELD} font-mono`} autoComplete="new-password" /></div>
        </div>
        {err && <div className="text-[12px] text-coral-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {err}</div>}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={saving || !name.trim() || !email.trim()}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add user</Button>
        </div>
      </div>
    </div>
  );
}
