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

export function injectLanguagePrompt(basePrompt: string, context: "plan" | "direct" | "synth"): string {
  const langPrompt = getLanguagePrompt(context);
  if (!langPrompt) return basePrompt;
  return basePrompt + "\n\n" + langPrompt;
}
