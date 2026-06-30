import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Loader2, BookOpen, CheckCircle, Download, FileText, ExternalLink } from "lucide-react";

export function KnowledgePacks() {
  const [packs, setPacks] = useState<any[]>([]);
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

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin w-6 h-6" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Knowledge Packs</h1>
      </div>
      <p className="text-sm text-gray-500">
        Install curated knowledge packs for your sector. These markdown files live in your vault under{" "}
        <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">_knowledge-packs/</code>{" "}
        and are automatically searchable via vault search.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {packs.map(pack => (
          <div key={pack.sectorId} className={`bg-white dark:bg-gray-800 rounded-lg border p-4 ${pack.installed ? "border-green-300 dark:border-green-700" : ""}`}>
            <div className="flex items-start justify-between mb-2">
              <h2 className="font-semibold">{pack.name}</h2>
              {pack.installed && <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />}
            </div>

            {pack.installed ? (
              <div className="space-y-2">
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">Installed ({pack.files.length} files)</p>
                <div className="space-y-1">
                  {pack.files.map((f: any) => (
                    <div key={f.path} className="flex items-center gap-2 text-xs text-gray-500">
                      <FileText className="w-3 h-3 shrink-0" />
                      <span className="truncate">{f.title}</span>
                      <span className="shrink-0">({f.wordCount} words)</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-gray-400 mb-3">Not installed</p>
                <button
                  onClick={() => install(pack.sectorId)}
                  disabled={installing === pack.sectorId}
                  className="flex items-center gap-2 text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {installing === pack.sectorId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  Install Pack
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {packs.every(p => p.installed) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 p-4 text-sm text-blue-700 dark:text-blue-300">
          All knowledge packs installed. Use vault search to query them — they are indexed alongside your other notes.
        </div>
      )}
    </div>
  );
}
