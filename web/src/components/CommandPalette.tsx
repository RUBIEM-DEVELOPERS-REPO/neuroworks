import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare, Users, ListChecks, FileText, CheckCircle2, Activity as ActivityIcon,
  ShieldCheck, BookOpen, Library, Settings as SettingsIcon, Wrench, Sparkles,
  UserCircle, PlusCircle, Search as SearchIcon, LayoutDashboard, Calendar, Shield,
  Terminal as TerminalIcon, Plug,
  type LucideIcon,
} from "lucide-react";
import { Kbd, MetaKey } from "./Kbd";

type Item = {
  id: string;
  label: string;
  group: "Navigate" | "Actions" | "Library";
  icon: LucideIcon;
  onSelect: () => void;
  keywords?: string;
  shortcut?: string;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function go(to: string) {
    return () => { nav(to); setOpen(false); };
  }

  const items: Item[] = [
    { id: "n-dashboard", group: "Navigate", label: "Dashboard", icon: LayoutDashboard, onSelect: go("/dashboard"), keywords: "home overview" },
    { id: "n-chat", group: "Navigate", label: "Chat", icon: MessageSquare, onSelect: go("/chat"), keywords: "talk message" },
    { id: "n-team", group: "Navigate", label: "Team", icon: Users, onSelect: go("/team"), keywords: "personas employees dispatch" },
    { id: "n-presets", group: "Navigate", label: "Hire a worker (Presets)", icon: Sparkles, onSelect: go("/presets"), keywords: "preset role hire onboard setup wizard sdr assistant recruiter" },
    { id: "n-tasks", group: "Navigate", label: "Tasks", icon: ListChecks, onSelect: go("/tasks"), keywords: "jobs queue" },
    { id: "n-reports", group: "Navigate", label: "Reports", icon: FileText, onSelect: go("/results"), keywords: "results outputs" },
    { id: "n-knowledge", group: "Navigate", label: "Knowledge vault", icon: BookOpen, onSelect: go("/knowledge"), keywords: "vault notes search" },
    { id: "n-approvals", group: "Navigate", label: "Approvals", icon: CheckCircle2, onSelect: go("/approvals"), keywords: "review pending" },
    { id: "n-activity", group: "Navigate", label: "Activity feed", icon: ActivityIcon, onSelect: go("/activity"), keywords: "live log" },
    { id: "n-schedules", group: "Navigate", label: "Schedules", icon: Calendar, onSelect: go("/schedules"), keywords: "cron recurring schedule" },

    { id: "a-new-chat", group: "Actions", label: "New chat", icon: PlusCircle, onSelect: go("/chat"), keywords: "start fresh session" },
    { id: "a-dispatch-team", group: "Actions", label: "Dispatch a team task", icon: Users, onSelect: go("/team") },
    { id: "a-search-vault", group: "Actions", label: "Search the vault", icon: SearchIcon, onSelect: go("/knowledge") },
    { id: "a-new-schedule", group: "Actions", label: "Create a schedule", icon: Calendar, onSelect: go("/schedules"), keywords: "recurring template fire" },

    { id: "l-templates", group: "Library", label: "Templates", icon: Library, onSelect: go("/templates") },
    { id: "l-skills", group: "Library", label: "Skills", icon: Sparkles, onSelect: go("/skills") },
    { id: "l-personas", group: "Library", label: "Personas", icon: UserCircle, onSelect: go("/personas") },
    { id: "l-governance", group: "Library", label: "Governance", icon: Shield, onSelect: go("/governance"), keywords: "policy guardrail compliance" },
    { id: "l-admin", group: "Library", label: "Admin", icon: ShieldCheck, onSelect: go("/admin") },
    { id: "l-integrations", group: "Library", label: "Integrations", icon: Plug, onSelect: go("/integrations"), keywords: "connect slack telegram github notion social oauth api" },
    { id: "l-terminal", group: "Library", label: "Terminal", icon: TerminalIcon, onSelect: go("/terminal"), keywords: "shell command console run" },
    { id: "l-settings", group: "Library", label: "Settings", icon: SettingsIcon, onSelect: go("/settings") },
    { id: "l-tools", group: "Library", label: "Tools", icon: Wrench, onSelect: go("/admin"), keywords: "config" },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" />
      <Command
        label="Command palette"
        className="relative w-full max-w-xl bg-ink-900 border border-ink-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-ink-800">
          <SearchIcon size={16} className="text-cream-300/60" />
          <Command.Input
            autoFocus
            placeholder="Search commands, pages, actions..."
            className="flex-1 bg-transparent py-3 text-sm text-cream-50 placeholder:text-cream-300/40 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
          <Command.Empty className="text-sm text-cream-300/60 text-center py-8">
            No results.
          </Command.Empty>
          {(["Navigate", "Actions", "Library"] as const).map(group => (
            <Command.Group
              key={group}
              heading={group}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-cream-300/50"
            >
              {items.filter(i => i.group === group).map(i => {
                const Icon = i.icon;
                return (
                  <Command.Item
                    key={i.id}
                    value={`${i.label} ${i.keywords ?? ""}`}
                    onSelect={i.onSelect}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-cream-200 cursor-pointer aria-selected:bg-ink-800 aria-selected:text-cream-50"
                  >
                    <Icon size={16} className="text-cream-300/70" />
                    <span className="flex-1">{i.label}</span>
                    {i.shortcut && <Kbd>{i.shortcut}</Kbd>}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
        <div className="border-t border-ink-800 px-4 py-2 flex items-center gap-3 text-[10px] text-cream-300/50">
          <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
          <span className="ml-auto flex items-center gap-1"><MetaKey /><Kbd>K</Kbd> toggle</span>
        </div>
      </Command>
    </div>
  );
}
