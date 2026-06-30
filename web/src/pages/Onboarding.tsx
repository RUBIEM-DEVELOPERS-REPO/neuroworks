import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type OnboardingData, type SectorInfo } from "../lib/api";
import { t, setLanguage, type Language } from "../lib/i18n";
import {
  Building2, Sprout, HeartPulse, GraduationCap, ShoppingCart, HandHeart, Pickaxe,
  ChevronRight, ChevronLeft, Check, Globe, Sparkles, ArrowRight,
  type LucideIcon,
} from "lucide-react";

const SECTOR_ICONS: Record<string, LucideIcon> = {
  Building2, Sprout, HeartPulse, GraduationCap, ShoppingCart, HandHeart, Pickaxe,
};

function SectorIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  const Icon = SECTOR_ICONS[icon] ?? Building2;
  return <Icon size={size} />;
}

const STEPS = ["sector", "language", "org"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS: Record<Step, string> = { sector: "Sector", language: "Language", org: "Organization" };

export function Onboarding() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [sectors, setSectors] = useState<SectorInfo[]>([]);
  const [step, setStep] = useState<Step>("sector");
  const [sectorId, setSectorId] = useState("");
  const [lang, setLang] = useState<Language>("en");
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    api.getOnboarding().then(r => {
      setSectors(r.sectors);
      if (r.state?.sector) setSectorId(r.state.sector);
      if (r.state?.language) setLang(r.state.language as Language);
      if (r.state?.orgName) setOrgName(r.state.orgName);
    }).catch(() => {});
  }, []);

  const stepIndex = STEPS.indexOf(step);
  const totalSteps = STEPS.length;

  async function handleFinish() {
    setBusy(true);
    try {
      setLanguage(lang);
      await api.setOnboarding({ completed: true, sector: sectorId || undefined, language: lang, orgName: orgName || undefined });
      navigate("/dashboard");
    } catch (e: any) {
      setBusy(false);
    }
  }

  async function handleSkip() {
    try { setLanguage("en"); await api.setOnboarding({ completed: true }); } catch {}
    navigate("/dashboard");
  }

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                i <= stepIndex ? "bg-violet-500 text-white" : "bg-ink-800 text-cream-300/50"
              }`}>{i + 1}</div>
              <span className={`text-xs hidden sm:inline ${i <= stepIndex ? "text-cream-100" : "text-cream-300/50"}`}>
                {STEP_LABELS[s]}
              </span>
              {i < totalSteps - 1 && <div className={`w-8 h-px ${i < stepIndex ? "bg-violet-500" : "bg-ink-800"}`} />}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-ink-900 border border-ink-800 rounded-2xl p-8">
          {step === "sector" && (
            <div className="space-y-6">
              <div className="text-center">
                <Sparkles size={28} className="text-violet-400 mx-auto mb-3" />
                <h1 className="font-display text-2xl text-cream-50">{t("onboarding.sector")}</h1>
                <p className="text-sm text-cream-300/70 mt-1">{t("onboarding.sectorDesc")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
                {sectors.map(s => {
                  const selected = sectorId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setSectorId(s.id); setTimeout(() => setStep("language"), 300); }}
                      className={`text-left p-4 rounded-xl border transition-all ${
                        selected
                          ? "bg-violet-500/10 border-violet-500/50 ring-1 ring-violet-500/30"
                          : "bg-ink-800/50 border-ink-700 hover:border-violet-500/30 hover:bg-ink-800"
                      }`}
                    >
                      <div className={`mb-2 ${selected ? "text-violet-400" : "text-cream-300"}`}>
                        <SectorIcon icon={s.icon} size={20} />
                      </div>
                      <div className="font-display text-sm text-cream-50 leading-tight">{s.name}</div>
                      <div className="text-[11px] text-cream-300/60 mt-1 line-clamp-2">{s.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === "language" && (
            <div className="space-y-6">
              <div className="text-center">
                <Globe size={28} className="text-violet-400 mx-auto mb-3" />
                <h1 className="font-display text-2xl text-cream-50">{t("onboarding.language")}</h1>
                <p className="text-sm text-cream-300/70 mt-1">{t("onboarding.languageDesc")}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(["en", "sn", "nd"] as Language[]).map(code => (
                  <button
                    key={code}
                    onClick={() => { setLang(code); setLanguage(code); }}
                    className={`p-4 rounded-xl border text-center transition-all ${
                      lang === code
                        ? "bg-violet-500/10 border-violet-500/50 ring-1 ring-violet-500/30"
                        : "bg-ink-800/50 border-ink-700 hover:border-violet-500/30"
                    }`}
                  >
                    <div className="font-display text-lg text-cream-50">{t(`onboarding.language.${code}`)}</div>
                    <div className="text-xs text-cream-300/60 mt-1">
                      {code === "en" ? "English" : code === "sn" ? "chiShona" : "isiNdebele"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "org" && (
            <div className="space-y-6">
              <div className="text-center">
                <Building2 size={28} className="text-violet-400 mx-auto mb-3" />
                <h1 className="font-display text-2xl text-cream-50">{t("onboarding.orgName")}</h1>
                <p className="text-sm text-cream-300/70 mt-1">Give your workforce a name (optional).</p>
              </div>
              <input
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                placeholder={t("onboarding.orgNamePlaceholder")}
                className="w-full bg-ink-800 border border-ink-700 rounded-xl px-4 py-3 text-cream-100 placeholder:text-cream-300/40 outline-none focus:border-violet-500/60 transition-colors"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleFinish(); }}
              />
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-ink-800">
            {stepIndex > 0 ? (
              <button
                onClick={() => setStep(STEPS[stepIndex - 1])}
                className="flex items-center gap-1.5 text-sm text-cream-300 hover:text-cream-50 px-3 py-2 rounded-md hover:bg-ink-800 transition-colors"
              >
                <ChevronLeft size={16} /> {t("onboarding.back")}
              </button>
            ) : (
              <button onClick={handleSkip} className="text-sm text-cream-300/50 hover:text-cream-300 px-3 py-2 rounded-md hover:bg-ink-800 transition-colors">
                {t("onboarding.skipped")}
              </button>
            )}
            {step === "org" ? (
              <button
                onClick={handleFinish}
                disabled={busy}
                className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
              >
                {busy ? "Saving…" : <>{t("onboarding.finish")} <ArrowRight size={16} /></>}
              </button>
            ) : (
              <button
                onClick={() => setStep(STEPS[stepIndex + 1])}
                className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
              >
                {t("onboarding.next")} <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-cream-300/40 mt-6">
          NeuroWorks — your local AI workforce. Configured for Zimbabwe.
        </p>
      </div>
    </div>
  );
}
