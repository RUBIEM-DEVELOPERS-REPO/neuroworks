import { useState } from "react";
import { api } from "../lib/api";
import { Loader2, Hammer, Sparkles, Eye, Save, AlertCircle, CheckCircle } from "lucide-react";

export function SkillForge() {
  const [intent, setIntent] = useState("");
  const [taskSample, setTaskSample] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ skill: any; raw: string } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const forge = async () => {
    if (!intent.trim() || !taskSample.trim()) return;
    setLoading(true);
    setError("");
    setDraft(null);
    setSaved(false);
    try {
      const result = await api.draftSkill(intent.trim(), taskSample.trim(), failureReason.trim() || undefined);
      setDraft(result);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate skill");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await api.saveSkill(intent.trim(), draft.raw);
      if (result.ok) setSaved(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save skill");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Hammer className="w-6 h-6" />
        <h1 className="text-2xl font-bold">SkillForge</h1>
      </div>
      <p className="text-sm text-cream-300/60">
        Generate a skill playbook from a natural language description. The LLM writes a structured markdown skill
        with frontmatter, process, rules, and pitfalls. Review and save it to your skill library.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Intent label</label>
            <input value={intent} onChange={e => setIntent(e.target.value)} placeholder="e.g. draft-email, compliance-check" className="text-sm border rounded px-3 py-2 bg-ink-900" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Task sample</label>
            <textarea value={taskSample} onChange={e => setTaskSample(e.target.value)} rows={4} placeholder="Paste a real task that this skill should handle…" className="text-sm border rounded px-3 py-2 bg-ink-900" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Failure reason (optional)</label>
            <textarea value={failureReason} onChange={e => setFailureReason(e.target.value)} rows={2} placeholder="What went wrong last time? Helps the LLM draft better rules…" className="text-sm border rounded px-3 py-2 bg-ink-900" />
          </div>
          <button
            onClick={forge}
            disabled={loading || !intent.trim() || !taskSample.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Forge Skill
          </button>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded bg-coral-500/10 border border-coral-500/30 text-sm text-coral-300 ">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {draft && (
            <>
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4" />
                <span className="font-medium text-sm">Draft: {draft.skill.name}</span>
                {draft.skill.applies_to?.length > 0 && (
                  <span className="text-xs text-cream-300/50">applies to: {draft.skill.applies_to.join(", ")}</span>
                )}
              </div>
              <pre className="text-xs border rounded p-3 bg-ink-950 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                {draft.raw}
              </pre>
              <div className="flex items-center gap-2">
                {saved ? (
                  <div className="flex items-center gap-2 text-sm text-leaf-400">
                    <CheckCircle className="w-4 h-4" /> Saved to skill library
                  </div>
                ) : (
                  <button
                    onClick={save}
                    disabled={saving}
                    className="flex items-center gap-2 px-3 py-1.5 rounded bg-leaf-500 text-white hover:bg-leaf-600 disabled:opacity-50 text-sm"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save to Library
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
