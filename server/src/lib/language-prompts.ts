import { getOnboardingState } from "./sector-packs.js";

export type LanguagePrompt = {
  label: string;
  plan: string;
  direct: string;
  synth: string;
};

export const LANGUAGE_PROMPTS: Record<string, LanguagePrompt> = {
  en: {
    label: "English",
    plan: "",
    direct: "",
    synth: "",
  },
  sn: {
    label: "chiShona",
    plan: `Language: chiShona. Plan steps in English, but the final answer to the user must be in Shona (chiShona) unless the user wrote their task in English.

Respond using natural, respectful Shona. Use 'munhu' for person, 'basa' for work, 'rubatsiro' for help. Address the user as 'imi' (respectful you). Use Zimbabwean Shona vocabulary — avoid standardised/ textbook constructions when a natural Zimbabwean equivalent exists.

When explaining technical concepts, provide the Shona term first, then the English in parentheses: 'bhajeti (budget)', 'rubatsiro rwemari (financial assistance)'. Do NOT translate proper nouns, tool names (vault.search, ollama.generate), or file paths.`,
    direct: `Language: chiShona. Respond to the user in Shona (chiShona) with natural, conversational phrasing using Zimbabwean Shona vocabulary.

Rules:
- Use 'imi' for respectful address.
- Explain technical terms: Shona first, English in parentheses.
- Keep the same professional tone and structure as the English prompt but in Shona.
- Do NOT translate proper nouns, tool names, or branded terms.
- Greetings should feel natural for a Zimbabwean Shona speaker: 'Mhoro', 'Maswera sei', 'Ndimi?'`,
    synth: `Language: chiShona. Synthesise evidence and produce the answer in Shona (chiShona) using natural Zimbabwean Shona vocabulary.

Rules:
- Use 'imi' for respectful address.
- Cite evidence using the same [N] citation format but embed in Shona prose.
- Explain technical terms: Shona first, English in parentheses.
- Keep the same professional document structure as the English prompt (headings, bullets) but in Shona.
- Do NOT translate proper nouns, tool names, branded terms, or file paths.
- When evidence is thin, say so in Shona: 'Zvinyorwa zvishoma — ndinoda rumwe ruzivo.',
- Greetings: 'Mhoro', 'Maswera sei'`,
  },
  nd: {
    label: "isiNdebele",
    plan: `Language: isiNdebele. Plan steps in English, but the final answer to the user must be in isiNdebele unless the user wrote their task in English.

Respond using natural, respectful isiNdebele. Use 'umuntu' for person, 'umsebenzi' for work, 'usizo' for help. Address the user as 'lina' or 'nkosi' (respectful you). Use Zimbabwean Ndebele vocabulary — avoid Zulu-dominated constructions when a Zimbabwean Ndebele equivalent exists.

When explaining technical concepts, provide the Ndebele term first, then the English in parentheses: 'ibhajethi (budget)', 'usizo lwezimali (financial assistance)'. Do NOT translate proper nouns, tool names (vault.search, ollama.generate), or file paths.`,
    direct: `Language: isiNdebele. Respond to the user in isiNdebele with natural, conversational phrasing using Zimbabwean Ndebele vocabulary.

Rules:
- Use 'lina' or 'nkosi' for respectful address.
- Explain technical terms: isiNdebele first, English in parentheses.
- Keep the same professional tone and structure as the English prompt but in isiNdebele.
- Do NOT translate proper nouns, tool names, or branded terms.
- Greetings: 'Sawubona', 'Linjani', 'Yebo'`,
    synth: `Language: isiNdebele. Synthesise evidence and produce the answer in isiNdebele using Zimbabwean Ndebele vocabulary.

Rules:
- Use 'lina' or 'nkosi' for respectful address.
- Cite evidence using the same [N] citation format but embed in isiNdebele prose.
- Explain technical terms: isiNdebele first, English in parentheses.
- Keep the same professional document structure as the English prompt (headings, bullets) but in isiNdebele.
- Do NOT translate proper nouns, tool names, branded terms, or file paths.
- When evidence is thin, say so in Ndebele: 'Imibhalo incane — ngidinga olunye ulwazi.',
- Greetings: 'Sawubona', 'Linjani'`,
  },
};

export function getActiveLanguage(): string {
  try {
    return getOnboardingState().language || "en";
  } catch {
    return "en";
  }
}

export function getLanguagePrompt(context: "plan" | "direct" | "synth"): string {
  const lang = getActiveLanguage();
  if (lang === "en" || !LANGUAGE_PROMPTS[lang]) return "";
  return LANGUAGE_PROMPTS[lang][context];
}

// Org-wide "caveman" answer style — radically terse output with all
// technical substance intact. Injected for synth/direct only: the planner
// emits JSON and must never be style-shifted. Toggled in Settings
// (OnboardingState.responseStyle).
const CAVEMAN_STYLE_PROMPT = `RESPONSE STYLE — TERSE MODE (org-wide setting):
- Drop articles (a/an/the) where the sentence survives without them, filler words (just/really/basically/actually), pleasantries (certainly/happy to help), and hedging (perhaps/might possibly).
- Sentence fragments are fine. Short words beat long ones ("big" not "extensive", "fix" not "implement a solution for").
- KEEP every piece of technical substance: numbers, names, dates, amounts, file paths, links, code, error messages (verbatim), and [N] citations. Compress the prose, never the facts.
- Keep document structure (headings, bullets, tables) when the deliverable calls for it — terse applies to sentences, not to completeness.
- Write normal full prose ONLY for: security warnings, irreversible-action confirmations, and legal/compliance language.`;

function getCavemanPrompt(context: "plan" | "direct" | "synth"): string {
  if (context === "plan") return "";
  try {
    return getOnboardingState().responseStyle === "caveman" ? CAVEMAN_STYLE_PROMPT : "";
  } catch {
    return "";
  }
}

export function injectLanguagePrompt(basePrompt: string, context: "plan" | "direct" | "synth"): string {
  const langPrompt = getLanguagePrompt(context);
  const stylePrompt = getCavemanPrompt(context);
  let out = basePrompt;
  if (langPrompt) out += "\n\n" + langPrompt;
  if (stylePrompt) out += "\n\n" + stylePrompt;
  return out;
}

// Per-agent language override — a persona/department agent can be pinned to
// a language regardless of the org-wide onboarding default that
// injectLanguagePrompt above applies. This is appended by
// personaSystemSuffix() in personas.ts, which runs AFTER injectLanguagePrompt
// at every call site (agent.ts concatenates
// `injectLanguagePrompt(...) + "\n\n" + personaSystemSuffix`) — so it lands
// LAST in the prompt and takes precedence rather than just stacking a second,
// possibly contradictory, language instruction next to the org default.
//
// Deliberately ONE block reused across plan/direct/synth (unlike
// LANGUAGE_PROMPTS' three phase-specific variants) — personaSystemSuffix has
// no notion of which phase it's being concatenated into, and a single clear
// instruction is correct in all three.
export function personaLanguageDirective(language: string): string {
  if (language === "sn") {
    return `--- This agent's language (overrides any other language instruction above) ---\n${LANGUAGE_PROMPTS.sn.direct}`;
  }
  if (language === "nd") {
    return `--- This agent's language (overrides any other language instruction above) ---\n${LANGUAGE_PROMPTS.nd.direct}`;
  }
  if (language === "en") {
    // Explicit English pin — needed because LANGUAGE_PROMPTS.en's phase
    // strings are empty ("no special instruction" is how the org-wide
    // default expresses English), which would silently fail to override an
    // org default of Shona/Ndebele for this one agent.
    return `--- This agent's language (overrides any other language instruction above) ---\nRespond in English, even if an organization-wide default language instruction above says otherwise. This agent always communicates in English.`;
  }
  return "";
}
