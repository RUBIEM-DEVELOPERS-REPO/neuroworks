import { useEffect, useState } from "react";
import { CreditCard, Loader2, Link2, Copy, RefreshCw, ExternalLink, AlertTriangle, Receipt } from "lucide-react";
import { api, type PaymentGatewayStatus, type PaymentPrice, type PaymentRecord } from "../lib/api";
import { Card, Button, showToast } from "../components/Card";

// Payments — the Stripe gateway. Two jobs:
//   • Outbound billing: create a payment link to bill a client (agents do this
//     too via the payment.link primitive).
//   • Subscriptions: list plans + open a checkout session.
// Plus a recent-payments feed. All gated on STRIPE_SECRET_KEY server-side.

function money(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount); }
  catch { return `${currency.toUpperCase()} ${amount.toFixed(2)}`; }
}

export function Payments() {
  const [status, setStatus] = useState<PaymentGatewayStatus | null>(null);
  const [prices, setPrices] = useState<PaymentPrice[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const s = await api.paymentStatus();
      setStatus(s);
      if (s.enabled) {
        await Promise.all([
          api.listPrices().then(r => setPrices(r.prices)).catch(() => {}),
          api.listPayments(15).then(r => setPayments(r.payments)).catch(() => {}),
        ]);
      }
    } catch (e: any) { showToast(e?.message ?? String(e), "error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const currency = status?.currency ?? "zar";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><CreditCard size={24} /> Payments</h1>
          <p className="text-sm text-cream-300/70 mt-1">
            Collect money via Stripe — generate payment links to bill clients, sell subscription plans, and watch
            incoming payments. Agents can create links too with the <span className="font-mono">payment.link</span> primitive.
          </p>
        </div>
        <Button variant="subtle" onClick={refresh} disabled={loading}>{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh</Button>
      </div>

      {/* Gateway status */}
      <Card title="Gateway">
        {!status ? (
          <div className="text-sm text-cream-300/60">{loading ? "Checking…" : "Unknown"}</div>
        ) : !status.enabled ? (
          <div className="text-sm text-amber-300/90 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              Stripe isn’t configured. Set <span className="font-mono text-cream-200">STRIPE_SECRET_KEY</span> in <span className="font-mono">.env</span> and restart the server.
              Add <span className="font-mono text-cream-200">STRIPE_WEBHOOK_SECRET</span> to record paid events on the Activity feed.
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 text-leaf-400">
              <span className="w-2 h-2 rounded-full bg-leaf-500" /> Connected
            </span>
            <span className="text-cream-300/60">·</span>
            <span className="text-cream-200">{status.provider}</span>
            <span className="text-cream-300/60">·</span>
            <span className="text-cream-300/70">{currency.toUpperCase()}</span>
            {status.account && <><span className="text-cream-300/60">·</span><span className="font-mono text-[12px] text-cream-300/50">{status.account}</span></>}
            {status.livemode === false && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300">test mode</span>}
            {status.detail && <span className="text-coral-400 text-[12px]">· {status.detail}</span>}
          </div>
        )}
      </Card>

      <PaynowSection />

      <CardBrands />

      {status?.enabled && (
        <>
          <PaymentLinkForm currency={currency} />

          <Card title="Subscription plans" action={prices.length > 0 ? <span className="text-[11px] text-cream-300/50">{prices.length} price{prices.length === 1 ? "" : "s"}</span> : undefined}>
            {prices.length === 0 ? (
              <div className="text-sm text-cream-300/60">
                No prices found. Create products &amp; prices in your Stripe Dashboard — recurring prices show up here as plans you can sell.
              </div>
            ) : (
              <div className="space-y-2">
                {prices.map(p => <PriceRow key={p.id} price={p} />)}
              </div>
            )}
          </Card>

          <Card title="Recent payments" action={<span className="text-[11px] text-cream-300/50">{payments.length}</span>}>
            {payments.length === 0 ? (
              <div className="text-sm text-cream-300/60">No payments yet.</div>
            ) : (
              <div className="space-y-1.5">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-ink-950/50">
                    <Receipt size={15} className="text-cream-300/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-cream-100">{money(p.amount, p.currency)} <span className="text-cream-300/40">· {p.description ?? "—"}</span></div>
                      <div className="text-[11px] text-cream-300/40 font-mono truncate">{p.id} · {new Date(p.created * 1000).toLocaleString()}</div>
                    </div>
                    <StatusPill status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const FIELD = "w-full bg-ink-950 border border-ink-800 text-sm text-cream-100 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500/60 placeholder:text-cream-300/30";

// Paynow (Zimbabwe) — the local-market gateway beside Stripe: EcoCash,
// OneMoney, cards, bank. Create a payment (browserUrl the client pays on),
// then poll its status right here. Agents use payment.paynow_link /
// payment.paynow_poll for the same flow.
function PaynowSection() {
  const [status, setStatus] = useState<{ enabled: boolean; integrationId?: string; detail?: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [payment, setPayment] = useState<{ reference: string; browserUrl: string; pollUrl: string } | null>(null);
  const [pollResult, setPollResult] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => { api.paynowStatus().then(setStatus).catch(() => {}); }, []);

  async function create() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { showToast("Enter a positive amount", "error"); return; }
    if (!description.trim()) { showToast("Add a description", "error"); return; }
    setCreating(true); setPayment(null); setPollResult(null);
    try {
      const { payment } = await api.createPaynowLink({ amount: amt, description: description.trim(), email: email.trim() || undefined });
      setPayment(payment);
      showToast("Paynow payment created ✓", "success");
    } catch (e: any) { showToast(e?.message ?? String(e), "error"); }
    finally { setCreating(false); }
  }

  async function poll() {
    if (!payment) return;
    setPolling(true);
    try {
      const { status: st } = await api.paynowPoll(payment.pollUrl);
      setPollResult(`${st.status}${st.paid ? " — PAID ✓" : ""}${st.paynowReference ? ` · Paynow ref ${st.paynowReference}` : ""}`);
    } catch (e: any) { showToast(e?.message ?? String(e), "error"); }
    finally { setPolling(false); }
  }

  return (
    <Card title="Paynow — Zimbabwe (EcoCash · OneMoney · cards)">
      {!status ? (
        <div className="text-sm text-cream-300/60">Checking…</div>
      ) : !status.enabled ? (
        <div className="text-sm text-amber-300/90 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            Paynow isn’t configured. Set <span className="font-mono text-cream-200">PAYNOW_INTEGRATION_ID</span> and{" "}
            <span className="font-mono text-cream-200">PAYNOW_INTEGRATION_KEY</span> in <span className="font-mono">.env</span> and restart.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 text-leaf-400"><span className="w-2 h-2 rounded-full bg-leaf-500" /> Connected</span>
            <span className="text-cream-300/60">·</span>
            <span className="text-cream-200">paynow</span>
            <span className="text-cream-300/60">·</span>
            <span className="font-mono text-[12px] text-cream-300/50">integration {status.integrationId}</span>
            <span className="text-[11px] text-cream-300/50">Agents: <span className="font-mono">payment.paynow_link</span></span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="sm:w-36">
              <label className="block text-[11px] text-cream-300/70 mb-1">Amount</label>
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="150.00" className={`${FIELD} font-mono`} />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-cream-300/70 mb-1">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Cognify course purchase" className={FIELD} />
            </div>
            <div className="sm:w-64">
              <label className="block text-[11px] text-cream-300/70 mb-1">Payer email (test mode: merchant email)</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="payer@company.com" className={`${FIELD} font-mono`} />
            </div>
            <div className="flex items-end">
              <Button onClick={create} disabled={creating}>{creating ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Create payment</Button>
            </div>
          </div>
          {payment && (
            <div className="rounded-lg border border-leaf-500/30 bg-leaf-500/5 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Link2 size={14} className="text-leaf-400 shrink-0" />
                <a href={payment.browserUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-[12px] text-violet-300 hover:text-violet-200 font-mono truncate">{payment.browserUrl}</a>
                <button type="button" onClick={() => { navigator.clipboard.writeText(payment.browserUrl); showToast("Copied", "success"); }} className="text-cream-300/60 hover:text-cream-100 p-1" title="Copy"><Copy size={14} /></button>
                <a href={payment.browserUrl} target="_blank" rel="noopener noreferrer" className="text-cream-300/60 hover:text-cream-100 p-1" title="Open"><ExternalLink size={14} /></a>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-cream-300/60">
                <span className="font-mono">ref {payment.reference}</span>
                <Button variant="subtle" onClick={poll} disabled={polling}>{polling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check status</Button>
                {pollResult && <span className="text-cream-200">{pollResult}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// Accepted card brands. Stripe already settles Visa/Mastercard, so these are
// surfaced as a roadmap signal ("coming soon") for direct card acceptance.
function CardBrands() {
  const brands = [
    { name: "Visa", className: "text-[#1a1f71] bg-ink-900", soon: true },
    { name: "Mastercard", className: "text-[#eb001b] bg-ink-900", soon: true },
  ];
  return (
    <Card title="Card brands">
      <div className="flex items-center gap-3 flex-wrap">
        {brands.map(b => (
          <div key={b.name} className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-md text-[13px] font-bold tracking-tight italic ${b.className}`}>{b.name}</span>
            {b.soon && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300">coming soon</span>}
          </div>
        ))}
        <span className="text-[11px] text-cream-300/50 ml-1">Direct Visa &amp; Mastercard acceptance is on the roadmap — payments currently route through the Stripe-hosted checkout.</span>
      </div>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  const ok = status === "succeeded" || status === "paid";
  const fail = status.includes("fail") || status === "canceled";
  const cls = ok ? "text-leaf-400 bg-leaf-500/10" : fail ? "text-coral-400 bg-coral-500/10" : "text-amber-300/90 bg-amber-400/10";
  return <span className={`text-[10px] px-2 py-0.5 rounded-full ${cls}`}>{status}</span>;
}

function PaymentLinkForm({ currency }: { currency: string }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  async function create() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { showToast("Enter a positive amount", "error"); return; }
    if (!description.trim()) { showToast("Add a description", "error"); return; }
    setCreating(true); setLink(null);
    try {
      const { link } = await api.createPaymentLink({ amount: amt, description: description.trim() });
      setLink(link.url);
      showToast("Payment link created ✓", "success");
    } catch (e: any) { showToast(e?.message ?? String(e), "error"); }
    finally { setCreating(false); }
  }

  return (
    <Card title="Bill a client — payment link">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-40">
          <label className="block text-[11px] text-cream-300/70 mb-1">Amount ({currency.toUpperCase()})</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="4999.00" className={`${FIELD} font-mono`} />
        </div>
        <div className="flex-1">
          <label className="block text-[11px] text-cream-300/70 mb-1">Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Consulting retainer — June" className={FIELD} />
        </div>
        <div className="flex items-end">
          <Button onClick={create} disabled={creating}>{creating ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Create link</Button>
        </div>
      </div>
      {link && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-leaf-500/30 bg-leaf-500/5 px-3 py-2">
          <Link2 size={14} className="text-leaf-400 shrink-0" />
          <a href={link} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-[12px] text-violet-300 hover:text-violet-200 font-mono truncate">{link}</a>
          <button type="button" onClick={() => { navigator.clipboard.writeText(link); showToast("Copied", "success"); }} className="text-cream-300/60 hover:text-cream-100 p-1" title="Copy"><Copy size={14} /></button>
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-cream-300/60 hover:text-cream-100 p-1" title="Open"><ExternalLink size={14} /></a>
        </div>
      )}
    </Card>
  );
}

function PriceRow({ price }: { price: PaymentPrice }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  async function checkout() {
    setBusy(true);
    try {
      const { session } = await api.createCheckout({ priceId: price.id, mode: price.interval ? "subscription" : "payment", customerEmail: email || undefined });
      window.open(session.url, "_blank", "noopener");
    } catch (e: any) { showToast(e?.message ?? String(e), "error"); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-ink-950/50 border border-ink-800">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-cream-100">
          {price.productName ?? price.nickname ?? price.id}
          {price.interval && <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300">/{price.interval}</span>}
        </div>
        <div className="text-[12px] text-cream-300/60">{money(price.unitAmount, price.currency)}{price.interval ? ` per ${price.interval}` : ""} · <span className="font-mono">{price.id}</span></div>
      </div>
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="customer email (optional)" className={`${FIELD} !w-56 !py-1.5 text-[12px]`} />
      <Button variant="subtle" onClick={checkout} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />} Checkout</Button>
    </div>
  );
}
