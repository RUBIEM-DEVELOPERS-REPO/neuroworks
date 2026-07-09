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
  // Department-template ids (see lib/department-templates.ts DEPARTMENT_TEMPLATES)
  // to feature on the dashboard for this sector. Knowledge packs aren't
  // listed here separately — listKnowledgePacks() already keys one pack per
  // sector.id 1:1, so "active knowledge pack for this sector" is a lookup,
  // not a suggestion list.
  suggestedDepartments: string[];
  contextNote: string;
};

export type Language = "en" | "sn" | "nd";

export type OnboardingState = {
  completed: boolean;
  sector?: string;
  // Free-text sector name, only meaningful when sector === "custom". The
  // "custom" Sector entry below has a generic Zimbabwe-operating-environment
  // contextNote (no fixed industry to write one for) — this is what the UI
  // shows instead of that entry's placeholder name.
  customSectorName?: string;
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
    suggestedDepartments: ["finance", "legal", "customer-support"],
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
    suggestedDepartments: ["operations", "sales", "customer-support"],
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
    suggestedDepartments: ["operations", "legal", "customer-support"],
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
    suggestedDepartments: ["marketing", "operations", "customer-support"],
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
    suggestedDepartments: ["sales", "marketing", "customer-support"],
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
    suggestedDepartments: ["operations", "finance", "legal", "grant-writing"],
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
    suggestedDepartments: ["operations", "legal", "finance"],
    contextNote: "Zimbabwe is rich in minerals: gold (the largest producer after SA), platinum group metals (Zimplats, Mimosa, Unki), diamonds (Marange), lithium (Arcadian, Kamativi), and chrome. The mining sector is a major foreign currency earner. Key challenges: artisanal mining regulation, royalty compliance (ZIMRA), and community development agreements.",
  },
  {
    id: "tourism",
    name: "Tourism & Hospitality",
    nameShona: "Zvekushanyira",
    nameNdebele: "Ezokuvakasha",
    description: "Hotels, lodges, tour operators, and travel services",
    icon: "Palmtree",
    suggestedTemplates: ["run-digest", "summarize-repo", "publish-folder"],
    suggestedIntegrations: ["slack", "google", "webhook"],
    suggestedDepartments: ["marketing", "sales", "customer-support"],
    contextNote: "Zimbabwe's tourism sector is anchored by Victoria Falls, Hwange National Park, and Great Zimbabwe, and is a key forex earner regulated by the Zimbabwe Tourism Authority (ZTA). The UNIVISA (KAZA) scheme with Zambia simplifies cross-border travel. Key challenges: seasonal demand swings, USD-pricing in a dual-currency economy, and building direct-booking channels to reduce dependence on foreign OTAs.",
  },
  {
    id: "government",
    name: "Government & Public Sector",
    nameShona: "Hurumende",
    nameNdebele: "Uhulumende",
    description: "Public service delivery, municipal operations, and policy administration",
    icon: "Landmark",
    suggestedTemplates: ["compliance-check", "run-digest", "research-deep"],
    suggestedIntegrations: ["slack", "webhook"],
    suggestedDepartments: ["legal", "operations", "communications"],
    contextNote: "Zimbabwe's public sector spans central ministries, ZIMRA (revenue), RBZ (monetary policy), and devolved local authorities under the devolution agenda. E-Government initiatives are expanding digital service delivery. Key challenges: procurement compliance (PRAZ), records management across paper and digital systems, and citizen-facing service turnaround times.",
  },
  {
    id: "it-tech",
    name: "IT & Tech",
    nameShona: "Tekinoroji",
    nameNdebele: "Ubuchwepheshe",
    description: "Software, telecoms, digital services, and the local start-up ecosystem",
    icon: "Cpu",
    suggestedTemplates: ["summarize-repo", "run-digest", "compliance-check"],
    suggestedIntegrations: ["slack", "github", "webhook"],
    suggestedDepartments: ["it-devops", "marketing", "sales"],
    contextNote: "Zimbabwe's tech sector is regulated by POTRAZ (telecoms/postal) and anchored by players like Econet/Cassava and a growing fintech-adjacent start-up scene. Mobile penetration outpaces fixed broadband, so mobile-first product design matters. Key challenges: forex access for cloud/SaaS spend, data protection compliance under the Data Protection Act, and load-shedding-resilient infrastructure.",
  },
  {
    id: "informal-trade",
    name: "Informal Trade & SME Retail",
    nameShona: "Zvekutengeserana",
    nameNdebele: "Ukuthengiselana",
    description: "Vendors, cross-border traders, and small/medium retail businesses",
    icon: "Store",
    suggestedTemplates: ["run-digest", "summarize-repo"],
    suggestedIntegrations: ["slack", "webhook"],
    suggestedDepartments: ["sales", "operations", "finance"],
    contextNote: "Zimbabwe's informal economy is one of the largest in the world by share of GDP — vendors, kopje markets, and cross-border traders (omalayitsha/malaishas moving goods to and from South Africa/Zambia/Botswana) alongside formally registered SMEs. SMEDCO supports SME formalisation and financing. Key challenges: USD/ZWL dual pricing, cash-based bookkeeping with little digital record-keeping, and access to affordable credit.",
  },
  {
    id: "custom",
    name: "Custom",
    nameShona: "Yakasarudzika",
    nameNdebele: "Okuzenzakalelayo",
    description: "Tell us about your sector — we'll still tune the workforce for Zimbabwe",
    icon: "MoreHorizontal",
    suggestedTemplates: ["run-digest", "summarize-repo", "research-deep"],
    suggestedIntegrations: ["slack", "webhook"],
    suggestedDepartments: ["operations", "marketing", "finance"],
    contextNote: "Operating in Zimbabwe generally means planning around forex access (USD/ZWL dual pricing), variable power availability (load-shedding), and mobile-first connectivity. Regulatory touchpoints most businesses share: ZIMRA (tax), RBZ (forex/banking), and the Data Protection Act for anything handling personal data. Set a specific sector name during onboarding and this note can be refined further.",
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
