import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, Loader2, AlertTriangle } from "lucide-react";
import { api, setToken } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { Button, showToast } from "../components/Card";

// Login page — the identity layer. Signing in attributes activity to a person
// and is tracked (login history on the Users page). The app itself is loopback-
// only; this isn't a hard network gate. First login for an account with no
// password set claims that password.

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !email.trim()) return;
    setErr(null); setBusy(true);
    try {
      const r = await api.login(email.trim(), password);
      setToken(r.token);
      showToast(`Signed in as ${r.user.name}`, "success");
      navigate("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  const FIELD = "w-full bg-ink-950 border border-ink-800 text-sm text-cream-100 rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500/60 placeholder:text-cream-300/30";

  return (
    <div className="min-h-screen grid place-items-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <BrandMark size={40} />
          <div className="mt-3 text-xl font-semibold text-cream-50 tracking-tight">NeuroWorks</div>
          <div className="text-[11px] text-cream-300/60 uppercase tracking-wider mt-1">Sign in to your workspace</div>
        </div>
        <form onSubmit={submit} className="bg-ink-900 border border-ink-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-[11px] text-cream-300/70 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@rubiem.com" autoComplete="username" autoFocus className={FIELD} />
          </div>
          <div>
            <label className="block text-[11px] text-cream-300/70 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" className={FIELD} />
            <div className="text-[10px] text-cream-300/40 mt-1">First sign-in for a new account sets its password.</div>
          </div>
          {err && <div className="text-[12px] text-coral-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {err}</div>}
          <Button onClick={() => submit()} disabled={busy || !email.trim()} className="w-full justify-center">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />} Sign in
          </Button>
        </form>
        <div className="text-center text-[11px] text-cream-300/40 mt-4">
          Local workspace · 127.0.0.1 · activity is attributed to your account
        </div>
      </div>
    </div>
  );
}
