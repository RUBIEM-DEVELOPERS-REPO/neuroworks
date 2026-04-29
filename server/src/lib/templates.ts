export type TemplateInput = {
  name: string;
  label: string;
  type: "text" | "number" | "boolean" | "repo-picker" | "textarea";
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
};

export type Template = {
  id: string;
  role: "Engineering" | "Knowledge" | "Operations" | "Insights";
  title: string;
  description: string;
  icon: string;
  inputs: TemplateInput[];
  requiresApproval: boolean;
  estimateSeconds: number;
  agent: "clawbot";
};

export const templates: Template[] = [
  {
    id: "summarize-repo",
    role: "Engineering",
    title: "Summarize a project",
    description: "Generate a concise project summary (purpose, stack, state, recent direction) and save it to your knowledge base.",
    icon: "sparkles",
    agent: "clawbot",
    inputs: [{ name: "repo", label: "Project", type: "repo-picker", required: true }],
    requiresApproval: false,
    estimateSeconds: 30,
  },
  {
    id: "run-digest",
    role: "Engineering",
    title: "Run daily digest",
    description: "Scan every project for recent activity (commits, PRs, issues) and write a digest to your knowledge base.",
    icon: "broadcast",
    agent: "clawbot",
    inputs: [{ name: "lookbackDays", label: "Days back", type: "number", default: 7 }],
    requiresApproval: false,
    estimateSeconds: 60,
  },
  {
    id: "publish-folder",
    role: "Engineering",
    title: "Publish a local folder",
    description: "Take a folder on this machine, create a private GitHub repo, and push it.",
    icon: "upload",
    agent: "clawbot",
    inputs: [
      { name: "path", label: "Folder path", type: "text", required: true, placeholder: "D:\\path\\to\\folder" },
      { name: "name", label: "Repo name", type: "text", placeholder: "auto from folder if blank" },
      { name: "public", label: "Public", type: "boolean", default: false },
    ],
    requiresApproval: true,
    estimateSeconds: 30,
  },
  {
    id: "search-brain",
    role: "Knowledge",
    title: "Search the knowledge base",
    description: "Find notes, digests, and summaries across your second brain.",
    icon: "search",
    agent: "clawbot",
    inputs: [{ name: "query", label: "What to search for", type: "text", required: true, placeholder: "scraper hub status" }],
    requiresApproval: false,
    estimateSeconds: 1,
  },
  {
    id: "add-note",
    role: "Knowledge",
    title: "Capture a fleeting note",
    description: "Drop a quick thought into your inbox to process later.",
    icon: "pencil",
    agent: "clawbot",
    inputs: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "body", label: "Note body", type: "textarea", required: true },
    ],
    requiresApproval: false,
    estimateSeconds: 2,
  },
  {
    id: "browse-vault",
    role: "Knowledge",
    title: "Browse my knowledge base",
    description: "Open the file tree of your Obsidian vault.",
    icon: "folder",
    agent: "clawbot",
    inputs: [],
    requiresApproval: false,
    estimateSeconds: 1,
  },
  {
    id: "sync-downloads",
    role: "Knowledge",
    title: "Sync downloads to vault",
    description: "Mirror new files from your Downloads folder into the vault. Source files are never moved or deleted — clawbot only copies.",
    icon: "download",
    agent: "clawbot",
    inputs: [
      { name: "source", label: "Source folder", type: "text", placeholder: "leave blank for ~/Downloads/" },
    ],
    requiresApproval: false,
    estimateSeconds: 60,
  },
];

export const roles = [
  { id: "Engineering", label: "Engineering", description: "Code, projects, GitHub", count: templates.filter(t => t.role === "Engineering").length },
  { id: "Knowledge", label: "Knowledge", description: "Notes, search, capture", count: templates.filter(t => t.role === "Knowledge").length },
  { id: "Operations", label: "Operations", description: "Schedules, integrations", count: templates.filter(t => t.role === "Operations").length },
  { id: "Insights", label: "Insights", description: "Research, analysis", count: templates.filter(t => t.role === "Insights").length },
];
