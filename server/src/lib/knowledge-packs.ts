import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { config } from "../config.js";
import { SECTORS, type Sector } from "./sector-packs.js";

export type KnowledgePack = {
  sectorId: string;
  name: string;
  installed: boolean;
  files: { path: string; title: string; wordCount: number }[];
};

const PACKS_DIR = "_knowledge-packs";

function packsRoot(): string {
  return resolve(config.vaultPath, PACKS_DIR);
}

export function listKnowledgePacks(): KnowledgePack[] {
  const root = packsRoot();
  return SECTORS.map(sector => {
    const sectorDir = join(root, sector.id);
    const installed = existsSync(sectorDir);
    const files: KnowledgePack["files"] = [];
    if (installed) {
      try {
        const entries = readdirSync(sectorDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            const content = readFileSync(join(sectorDir, entry.name), "utf8");
            const title = entry.name.replace(/\.md$/, "").replace(/-/g, " ");
            files.push({ path: join(PACKS_DIR, sector.id, entry.name), title, wordCount: content.split(/\s+/).length });
          }
        }
      } catch { /* corrupt dir */ }
    }
    return { sectorId: sector.id, name: sector.name, installed, files };
  });
}

export function installKnowledgePack(sectorId: string): { ok: boolean; files: string[] } {
  const sector = SECTORS.find(s => s.id === sectorId);
  if (!sector) return { ok: false, files: [] };

  const sectorDir = join(packsRoot(), sector.id);
  mkdirSync(sectorDir, { recursive: true });

  const written: string[] = [];
  for (const pack of generatePackFiles(sector)) {
    writeFileSync(join(sectorDir, pack.filename), pack.content, "utf8");
    written.push(join(PACKS_DIR, sector.id, pack.filename));
  }
  return { ok: true, files: written };
}

function generatePackFiles(sector: Sector): { filename: string; content: string }[] {
  const id = sector.id;
  return [
    {
      filename: `00-overview.md`,
      content: `# ${sector.name} — Knowledge Pack

## Sector Overview

${sector.description}

## Zimbabwe Context

${sector.contextNote}

## Recommended Templates
${sector.suggestedTemplates.map(t => `- \`${t}\``).join("\n")}

## Recommended Integrations
${sector.suggestedIntegrations.map(i => `- ${i}`).join("\n")}

## Key Considerations for Zimbabwe Operations
- Regulatory compliance is critical — ensure all automated workflows align with local laws
- Dual-currency environment (USD/ZWL) requires careful financial handling
- Mobile-first strategy recommended given high smartphone penetration
- Internet connectivity varies between urban and rural areas
`,
    },
    ...(id === "fintech" ? [{
      filename: `01-regulatory-framework.md`,
      content: `# FinTech Regulatory Framework — Zimbabwe

## Reserve Bank of Zimbabwe (RBZ) Guidelines
- All FinTech operators must register with RBZ
- Mobile money operators require a Payment Systems licence
- Know Your Customer (KYC) requirements apply to all digital financial services
- Transaction limits apply to mobile money (tiered based on KYC level)

## Key Regulations
- **Banking Act [Chapter 24:20]** — governs all banking operations
- **National Payment Systems Act [Chapter 24:23]** — governs mobile money and digital payments
- **Money Laundering and Proceeds of Crime Act** — AML/CFT compliance mandatory
- **Data Protection Act** — governs customer data handling

## Common Compliance Pain Points
1. Transaction reconciliation across multiple payment rails
2. Agent network management and liquidity monitoring
3. Financial literacy content for end-users
4. Reporting to RBZ — monthly statistical returns
5. Audit trail requirements for all transactions

## Mobile Money Ecosystem
- **EcoCash** — dominant player (Econet), ~8M users
- **OneMoney** — NetOne, ~2M users
- **Telecash** — Telecel, ~500K users
- Interoperability via RBZ's shared switching infrastructure

## Key Risks
- Liquidity risk at agent level
- Fraud — SIM swap, social engineering
- Regulatory changes (RBZ policy shifts)
- Foreign currency shortages affecting settlement
`,
    }, {
      filename: `02-use-cases.md`,
      content: `# FinTech Use Cases — Zimbabwe Market

## Top Use Cases for AI Agents

### 1. Transaction Reconciliation
Automated matching of mobile money transactions against core banking records.
- Monthly reconciliation of EcoCash agent float
- Cross-rail settlement matching (EcoCash ↔ bank accounts)
- Discrepancy flagging and alerting

### 2. Agent Network Management
Monitor and optimise the agent network for mobile money operators.
- Agent float position monitoring
- Rebalancing recommendations
- Agent performance scoring and tiering
- Compliance check reminders (licence renewal, KYC refreshes)

### 3. Financial Literacy Content
Generate and distribute financial education content in Shona/Ndebele/English.
- Savings tips tailored to informal sector workers
- Digital payments safety guides
- Small business bookkeeping basics
- Cross-border remittance guidance

### 4. Regulatory Reporting
Automate RBZ reporting requirements.
- Monthly statistical returns
- Transaction volume/value summaries
- Suspicious transaction reports (STR)
- Annual compliance reviews

### 5. Customer Onboarding Automation
Streamline KYC and account opening processes.
- Document verification workflows
- Risk profiling
- Account activation routing
- Ongoing monitoring triggers
`,
    }] : []),
    ...(id === "agriculture" ? [{
      filename: `01-zimbabwe-agriculture.md`,
      content: `# Agriculture Sector — Zimbabwe Knowledge Pack

## Sector Structure
- **Smallholder farmers** (~70% of population) — average 2-5 hectares
- **Commercial farms** — larger operations, tobacco, horticulture, livestock
- **Command Agriculture** — government input scheme for maize and other staples
- **Pfumvudza/Intwasa** — conservation agriculture program for smallholders

## Key Subsectors
1. **Tobacco** — largest export earner, auction system (TIMB)
2. **Cotton** — Cottco, ginning and marketing board
3. **Maize** — staple food, Grain Marketing Board (GMB)
4. **Sugar** — Triangle and Hippo Valley estates
5. **Horticulture** — citrus, avocados, flowers (export market)
6. **Livestock** — beef, dairy, poultry, pigs, goats
7. **Soybeans** — growing demand for cooking oil and stockfeed

## Key Challenges
- Climate variability — droughts and floods
- Input financing — access to seed, fertiliser, chemicals
- Market access — price discovery, transport logistics
- Extension services — limited reach to smallholders
- Land tenure security — 99-year leases, A1/A2 farm models

## Digital Opportunities
- Weather-indexed insurance products
- Mobile-based extension services
- Input tracking and supply chain visibility
- Market price information systems
- Tractor and equipment sharing platforms

## Regulatory Bodies
- **Ministry of Lands, Agriculture, Fisheries, Water and Rural Development**
- **Tobacco Industry and Marketing Board (TIMB)**
- **Grain Marketing Board (GMB)** — strategic grain reserve
- **Agricultural Marketing Authority (AMA)**
- **Zimbabwe Fertiliser Company (ZFC)**
- **Seed Co** — major seed supplier
`,
    }, {
      filename: `02-value-chain.md`,
      content: `# Agriculture Value Chain — AI Agent Applications

## Input Supply
- Seed distribution tracking
- Fertiliser inventory management
- Veterinary medicine stock monitoring
- Equipment maintenance scheduling

## Production
- Crop health monitoring via satellite imagery
- Irrigation scheduling optimisation
- Pest and disease early warning
- Livestock health tracking
- Record keeping for Pfumvudza compliance

## Post-Harvest
- Storage monitoring (moisture, temperature)
- Grading and quality control
- Loss tracking and reduction analytics
- Warehouse receipt system management

## Market Access
- Price intelligence across markets
- Buyer-seller matching
- Transport logistics coordination
- Contract farming compliance tracking
- Export documentation automation

## Cross-Cutting
- Climate data analysis and advisory
- Financing application processing
- Government scheme registration
- Subsidy management
`,
    }] : []),
  ];
}

export function getPackContent(sectorId: string, filename: string): string | null {
  const filePath = join(packsRoot(), sectorId, filename);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}
