// Shona/Ndebele conversational support — lets Zimbabwean users address
// agents in Shona, Ndebele, or English/Shona code-switching (the everyday
// norm in Zimbabwe) and get a response in kind.
//
// PROVENANCE: the vocabulary and financial-intent phrase list below are
// adapted from the ZimVoice project (RUBIEM-DEVELOPERS-REPO/ZimVoice,
// vocabulary.json + semantic_engine.py's ANCHORS table) — real domain data
// covering Zimbabwe mobile-money terms (EcoCash, ZiG, Zesa tokens) and how
// Zimbabweans actually phrase those requests in Shona/Ndebele/English.
// ZimVoice's own live audio-transcription API is NOT used here (its
// server-side ASR is disabled in that deployment) — this module only reuses
// the static vocabulary data, ported directly into NeuroWorks so no
// external service call is needed.
//
// There is no bespoke Shona<->English translation MODEL here — general
// conversation relies on the underlying LLM's own multilingual ability
// (Claude has real, if imperfect, Shona competency). This module's job is
// narrower: (1) detect that a message is Shona/Ndebele so the agent knows
// to respond in kind, and (2) ground Zimbabwe-specific financial/mobile-
// money jargon so the agent doesn't misread "tumira mari" or "magetsi" as
// noise.

// Common Shona/Ndebele words — greetings, function words, and everyday
// vocabulary frequent enough to reliably flag a message as Shona/Ndebele
// (or Shona/English code-switched, the Zimbabwean norm) without false-
// positiving on ordinary English. Word-boundary matched.
const SHONA_NDEBELE_MARKERS = [
  // Greetings / courtesies
  "mhoro", "mangwanani", "masikati", "manheru", "makadii", "makadini", "ndeipi",
  "salibonani", "sawubona", "unjani", "kunjani", "tatenda", "siyabonga", "ehe", "aiwa",
  "ndatenda", "zvakanaka", "ndiripo", "kwaziwai",
  // Common function/pronoun words
  "ndinoda", "ndoda", "ndiri", "muri", "wandiri", "ndinofunga", "ndakaita",
  "ndapota", "chokwadi", "sei", "ndeapi", "ndechipi", "kana", "asi", "nekuti",
  // Kin/social terms (from ZimVoice vocabulary.json)
  "sekuru", "ambuya", "gogo", "mainini", "babamunini", "vatete", "khulu",
  // Zimbabwe mobile-money / finance jargon (from ZimVoice ANCHORS)
  "tumira", "kutumira", "thumela", "thuma", "senda", "mari", "imali", "magetsi",
  "amagetsi", "zesa", "airtime", "ecocash", "onemoney", "zipit", "yasara",
  "bhadhara", "tenga", "kutenga",
] as const;

const SHONA_NDEBELE_RE = new RegExp(
  `\\b(?:${SHONA_NDEBELE_MARKERS.join("|")})\\b`,
  "gi",
);

/** True when the text contains enough Shona/Ndebele markers to treat it as
 *  Shona/Ndebele (or Shona-English code-switched) input, not incidental
 *  overlap with an English word. Requires 2+ distinct marker hits so a
 *  single ambiguous token ("sei" as a rare English name fragment, etc.)
 *  doesn't misfire on ordinary English. */
export function detectsShonaOrNdebele(text: string): boolean {
  if (!text) return false;
  const hits = new Set((text.match(SHONA_NDEBELE_RE) ?? []).map(s => s.toLowerCase()));
  return hits.size >= 2;
}

// Zimbabwe financial/mobile-money intent phrases — real Shona/Ndebele/
// English phrasings for each intent, straight from ZimVoice's ANCHORS
// table. Grounds the agent so "tumira mari kuna Tatenda" is read as a
// send-money request, not noise.
const ZIM_FINANCIAL_PHRASES: Record<string, string[]> = {
  "Send money": ["tumira mari", "thumela imali", "thuma mari", "senda"],
  "Buy airtime": ["isa airtime", "tenga airtime", "isira airtime"],
  "Buy data bundle": ["tenga data", "ndoda internet bundle", "data package"],
  "Buy electricity (Zesa token)": ["tenga magetsi", "ndoda maunits", "zesa token", "tenga i-zesa"],
  "Check balance": ["mari yasara", "ndine marii", "ko balance yangu", "ingaki imali esese"],
  "Mini statement": ["mini statement", "statement remari", "recent transactions"],
  "Pay bill / merchant": ["bhadhara bill", "bhadhara merchant", "pay school fees"],
};

/** Compact glossary block for prompt injection — only pulled in when
 *  detectsShonaOrNdebele() fires, so English-only chats never pay the
 *  token cost. */
export function shonaLanguageDirective(): string {
  const phraseLines = Object.entries(ZIM_FINANCIAL_PHRASES)
    .map(([intent, phrases]) => `  - ${intent}: ${phrases.join(" / ")}`)
    .join("\n");
  return (
    `**Zimbabwean-language input detected.** This message is in Shona, Ndebele, or Shona/English code-switching (the everyday norm in Zimbabwe). Understand it and respond in the SAME language/mix the user used, unless they explicitly ask for English. Match a natural, respectful Zimbabwean register (greetings matter — don't skip "Mhoro"/"Salibonani"-style openers if the user used one).\n\n` +
    `Zimbabwe mobile-money / financial phrase grounding (from real usage — use this to correctly read intent, not as a literal translation table):\n${phraseLines}\n\n` +
    `If a Shona/Ndebele phrase is genuinely ambiguous, ask for clarification in Shona rather than guessing or silently switching to English.`
  );
}
