import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, type KnowledgePack } from "../lib/api";
import { Loader2, BookOpen, CheckCircle2, Download, FileText, Database, Hash } from "lucide-react";
import { Card } from "../components/Card";

export function KnowledgePacks() {
  const nav = useNavigate();
  const [packs, setPacks] = useState<KnowledgePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.listKnowledgePacks().then(r => setPacks(r.packs)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const install = async (sectorId: string) => {
    setInstalling(sectorId);
    await api.installKnowledgePack(sectorId);
    setInstalling(null);
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin w-6 h-6 text-violet-400" /></div>;

  const datasetPacks = packs.filter(p => p.kind === "dataset");
  const sectorPacks = packs.filter(p => p.kind !== "dataset");

  return (
    <div className="space-y-6">
      <div>
        <div className="nw-eyebrow">Library</div>
        <h1 className="text-2xl font-semibold tracking-tight text-cream-50 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-violet-400" /> Knowledge Packs
        </h1>
        <p className="text-sm text-cream-300/70 mt-1 max-w-3xl">
          Curated sector packs plus datasets published by the{" "}
          <button onClick={() => nav("/data-pipeline")} className="text-violet-400 hover:text-violet-300">Intellinexus data pipeline</button>.
          All packs live in your vault under <span className="font-mono text-cream-200">_knowledge-packs/</span> and{" "}
          <span className="font-mono text-cream-200">_datasets/</span>, and are retrievable by agents via vault search.
        </p>
      </div>

      {datasetPacks.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-cream-100 mb-3 flex items-center gap-2">
            <Database size={15} className="text-violet-400" /> Dataset packs
            <span className="text-cream-300/50 font-normal">· agents learn from these</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {datasetPacks.map(pack => (
              <Card key={pack.sectorId} hoverable>
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-cream-50">{pack.name}</h3>
                  <CheckCircle2 className="w-5 h-5 text-leaf-400 shrink-0" />
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3 text-[10px]">
                  {pack.meta?.recordCount != null && (
                    <span className="px-1.5 py-0.5 rounded-full bg-ink-800 text-cream-300/70">{pack.meta.recordCount} records</span>
                  )}
                  {pack.meta?.avgConfidence != null && (
                    <span className="px-1.5 py-0.5 rounded-full bg-leaf-500/15 text-leaf-300">{Math.round(pack.meta.avgConfidence * 100)}% confidence</span>
                  )}
                  {pack.meta?.rootHash && (
                    <span className="px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 inline-flex items-center gap-1"><Hash size={9} />{pack.meta.rootHash.slice(0, 8)}</span>
                  )}
                </div>
                <div className="space-y-1">
                  {pack.files.map(f => (
                    <button
                      key={f.path}
                      onClick={() => nav("/knowledge/" + f.path.replace(/\\/g, "/"))}
                      className="w-full flex items-center gap-2 text-xs text-cream-300/70 hover:text-violet-300 text-left"
                    >
                      <FileText className="w-3 h-3 shrink-0" />
                      <span className="truncate">{f.title}</span>
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        {datasetPacks.length > 0 && (
          <h2 className="text-sm font-semibold text-cream-100 mb-3 flex items-center gap-2">
            <BookOpen size={15} className="text-violet-400" /> Sector packs
          </h2>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sectorPacks.map(pack => (
            <Card key={pack.sectorId} hoverable className={pack.installed ? "border-leaf-500/40" : ""}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-cream-50">{pack.name}</h3>
                {pack.installed && <CheckCircle2 className="w-5 h-5 text-leaf-400 shrink-0" />}
              </div>

              {pack.installed ? (
                <div className="space-y-2">
                  <p className="text-xs text-leaf-400 font-medium">Installed ({pack.files.length} files)</p>
                  <div className="space-y-1">
                    {pack.files.map(f => (
                      <button
                        key={f.path}
                        onClick={() => nav("/knowledge/" + f.path.replace(/\\/g, "/"))}
                        className="w-full flex items-center gap-2 text-xs text-cream-300/70 hover:text-violet-300 text-left"
                      >
                        <FileText className="w-3 h-3 shrink-0" />
                        <span className="truncate">{f.title}</span>
                        <span className="shrink-0 text-cream-300/40">({f.wordCount} words)</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-cream-300/40 mb-3">Not installed</p>
                  <button
                    onClick={() => install(pack.sectorId)}
                    disabled={installing === pack.sectorId}
                    className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50"
                  >
                    {installing === pack.sectorId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Install Pack
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {sectorPacks.every(p => p.installed) && sectorPacks.length > 0 && (
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg px-4 py-3 text-sm text-violet-200">
          All sector packs installed. Use vault search to query them — they're indexed alongside your other notes and published datasets.
        </div>
      )}
    </div>
  );
}
