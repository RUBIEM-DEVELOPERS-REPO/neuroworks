import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const CONFIG_PATH = resolve(CONFIG_DIR, "onboarding.json");

export type Sector = {
  id: string;
  name: string;
  nameShona?: string;
  nameNdebele?: string;
  description: string;
  icon: string;
  suggestedTemplates: string[];
  suggestedIntegrations: string[];
  contextNote: string;
};

export type Language = "en" | "sn" | "nd";

export type OnboardingState = {
  completed: boolean;
  sector?: string;
  language: Language;
  orgName?: string;
  completedAt?: string;
};

export const SECTORS: Sector[] = [
  {
    id: "fintech",
    name: "FinTech & Banking",
    nameShona: "Mari neBhangi",
    nameNdebele: "Imali lamaBhangi",
    description: "Digital payments, microfinance, banking operations, and financial inclusion",
    icon: "Building2",
    suggestedTemplates: ["summarize-repo", "run-digest", "compliance-check", "publish-folder"],
    suggestedIntegrations: ["slack", "github", "google"],
    contextNote: "Zimbabwe's FinTech sector is growing rapidly with mobile money (EcoCash, OneMoney) leading digital payments. Regulatory compliance with RBZ (Reserve Bank of Zimbabwe) is critical. Common pain points: transaction reconciliation, agent network management, and financial literacy content.",
  },
  {
    id: "agriculture",
    name: "Agriculture & Agribusiness",
    nameShona: "Zvekurima",
    nameNdebele: "Ezezolimo",
    description: "Farming operations, supply chain, crop monitoring, and market access",
    icon: "Sprout",
    suggestedTemplates: ["run-digest", "summarize-repo", "research-deep"],
    suggestedIntegrations: ["slack", "webhook"],
    contextNote: "Agriculture employs ~70% of Zimbabwe's workforce. Key challenges: climate-smart practices, input financing, market linkages, and extension services. The Pfumvudza/Intwasa program is a major government initiative for smallholder farmers.",
  },
  {
    id: "healthtech",
    name: "HealthTech & Public Health",
    nameShona: "Utano hweVeruzhinji",
    nameNdebele: "Ezempilo",
    description: "Healthcare delivery, patient records, telemedicine, and public health monitoring",
    icon: "HeartPulse",
    suggestedTemplates: ["compliance-check", "run-digest", "summarize-repo"],
    suggestedIntegrations: ["slack", "google", "webhook"],
    contextNote: "Zimbabwe's health system faces challenges with infectious diseases (HIV/TB/malaria), maternal health, and a growing NCD burden. The MOHCC (Ministry of Health) drives digital health through DHIS2. Key opportunities: stock-out prediction for essential medicines, patient journey tracking, and community health worker coordination.",
  },
  {
    id: "education",
    name: "EdTech & Education",
    nameShona: "Dzidzo",
    nameNdebele: "Imfundo",
    description: "Online learning, school management, curriculum development, and exam analytics",
    icon: "GraduationCap",
    suggestedTemplates: ["run-digest", "summarize-repo", "research-deep", "publish-folder"],
    suggestedIntegrations: ["slack", "google", "webhook"],
    contextNote: "Zimbabwe's education system follows a 2-7-4-2-4 structure (M-P-C-A). The curriculum was reformed in 2017 to include STEM and vocational subjects. Key challenges: teacher shortages, infrastructure gaps in rural areas, and exam leak management. O-level and A-level exams are administered by ZIMSEC.",
  },
  {
    id: "retail",
    name: "Retail & E-Commerce",
    nameShona: "Zvekutengesa",
    nameNdebele: "Ezokuthengisa",
    description: "Online retail, inventory management, customer analytics, and last-mile delivery",
    icon: "ShoppingCart",
    suggestedTemplates: ["summarize-repo", "run-digest", "publish-folder"],
    suggestedIntegrations: ["slack", "google", "webhook"],
    contextNote: "Zimbabwe's retail sector is dual: formal retailers (OK, TM Pick n Pay, Spar) alongside informal markets (kopje, Mbare Musika). E-commerce is growing with players like Mkahawa, ZOOM, and AstroMart. Common challenges: USD/ZWL dual pricing, inventory visibility across locations, and delivery logistics in high-density suburbs.",
  },
  {
    id: "ngo",
    name: "NGO & Development",
    nameShona: "Masangano ekubatsira",
    nameNdebele: "Izinhlangano eztithuthukisa",
    description: "Program management, grant reporting, beneficiary tracking, and M&E",
    icon: "HandHeart",
    suggestedTemplates: ["run-digest", "compliance-check", "research-deep", "publish-folder"],
    suggestedIntegrations: ["slack", "google", "github", "webhook"],
    contextNote: "Zimbabwe hosts a large development sector with UN agencies, INGOs, and CBOs. Key focus areas: food security (WFP), health (WHO/CDC), education (UNICEF), and governance (UNDP). Reporting requirements are stringent — donors expect quarterly narrative+financial reports with verifiable indicators.",
  },
  {
    id: "mining",
    name: "Mining & Resources",
    nameShona: "Migodhi",
    nameNdebele: "Izimayini",
    description: "Mining operations, mineral tracking, safety compliance, and supply chain",
    icon: "Pickaxe",
    suggestedTemplates: ["compliance-check", "run-digest", "summarize-repo"],
    suggestedIntegrations: ["slack", "webhook"],
    contextNote: "Zimbabwe is rich in minerals: gold (the largest producer after SA), platinum group metals (Zimplats, Mimosa, Unki), diamonds (Marange), lithium (Arcadian, Kamativi), and chrome. The mining sector is a major foreign currency earner. Key challenges: artisanal mining regulation, royalty compliance (ZIMRA), and community development agreements.",
  },
];

function defaultState(): OnboardingState {
  return { completed: false, language: "en" };
}

function load(): OnboardingState {
  try {
    if (!existsSync(CONFIG_PATH)) return defaultState();
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as OnboardingState;
  } catch { return defaultState(); }
}

function save(state: OnboardingState): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function getOnboardingState(): OnboardingState {
  return load();
}

export function setOnboardingState(update: Partial<OnboardingState> & { completed: boolean }): OnboardingState {
  const current = load();
  const next: OnboardingState = { ...current, ...update, completedAt: update.completed ? (current.completedAt ?? new Date().toISOString()) : current.completedAt };
  save(next);
  return next;
}

export function getSectorById(id: string): Sector | undefined {
  return SECTORS.find(s => s.id === id);
}

export function getSectorContext(sectorId: string): string {
  const sector = getSectorById(sectorId);
  return sector?.contextNote ?? "";
}
