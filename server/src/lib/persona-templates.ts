// Persona → starter template generator. Each persona's responsibilities become
// one-click custom templates so the dashboard immediately reflects what that
// role does day-to-day.
//
// Two paths:
//   • Generic — one template per responsibility, with an EMPTY plan. Running
//     it re-plans against the active persona's system prompt each time, so the
//     LLM stays in role. Good default — handles every persona out of the box.
//   • Curated — for known built-in personas (Researcher, etc.) we override
//     with hand-crafted templates whose plans pre-wire the right primitive
//     (e.g. research.multiperspective) so the user gets one-click access to
//     the persona's signature tool without paying the planner LLM cost.

import type { Persona } from "./personas.js";
import type { CustomTemplate } from "./custom-templates.js";
import { slugify, loadCustomTemplates, saveCustomTemplate, deleteCustomTemplate } from "./custom-templates.js";

// Curated templates per built-in persona id. When generateForPersona is
// called for one of these ids, we use this table INSTEAD of the generic
// responsibility-derived templates.
const CURATED: Record<string, (personaId: string) => Omit<CustomTemplate, "id" | "role">[]> = {
  clawbot: () => [
    {
      title: "Daily focus",
      description: "What should I focus on today? Looks at recent jobs in your vault, open threads, and notes flagged for follow-up.",
      origin: { task: "Look at the last 5 days of journal entries in _neuroworks/jobs/, any pending follow-ups in 0-Inbox/, and surface a short prioritised list of what I should focus on today. Include why each item matters.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Weekly vault review",
      description: "Goes through the past week of vault changes, identifies what to promote from 0-Inbox/, what to archive, and any cross-references worth making.",
      origin: { task: "Review what landed in the vault this past week. Surface notes worth promoting from 0-Inbox/ to 2-Permanent/, flag stale items, and suggest 2-3 new links between notes I might have missed.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Find related notes",
      description: "Given a topic, finds related notes in your vault and explains the connection. Use to surface threads you forgot you had.",
      origin: { task: "Find notes related to the following topic across the vault. For each, summarise the connection in one sentence. Return the most relevant 5-10 with paths.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Capture and connect",
      description: "Captures a new thought as a note and auto-links it to existing related notes in your vault.",
      origin: { task: "Capture the following thought as a new vault note. Then search the vault for related material and add [[wikilinks]] to the 2-3 most relevant existing notes.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Quick web look-up",
      description: "Fast factual web search with citations. Use for single questions you don't want to clutter the vault with.",
      origin: { task: "Look up the following question on the web. Give a tight 3-5 sentence answer with cited sources. Do not capture to the vault unless the answer is non-obvious.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],
  // Researcher is defined by its web access. Every template explicitly
  // invokes the web-fanning tools (research.multiperspective / web.search /
  // smartFetch) so the planner picks them and the user always sees real
  // citations from the live internet rather than model-recalled prose.
  researcher: () => [
    {
      title: "Web investigation (multi-perspective)",
      description: "Full multi-perspective web investigation — parallel sub-agents query the web from mainstream, critical, practitioner, and recent angles, then synthesise a cited report.",
      origin: {
        task: "Use research.multiperspective on the following topic with perspectives 'mainstream, critical, practitioner, recent'. Each sub-agent must hit the live web, fetch top sources, and cite [N]. Produce a structured report with Topic statement → Perspectives → Cross-cutting themes → Open questions → Bottom line. Capture to 0-Inbox/.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Latest news scan (web-only)",
      description: "Tight scan of the last 6-12 months on a topic using ONLY the 'recent' framing. Web-first, no synthesis of older context.",
      origin: {
        task: "Use research.multiperspective with perspectives='recent' to scan the live web for developments in the last 6-12 months on the following topic. Prefer news, blogs, releases, official announcements. Cite every claim with [N]. Note what changed compared to earlier consensus and flag what's still unconfirmed.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Compare two on the web",
      description: "Side-by-side web investigation of two approaches/tools/companies/positions. Parallel sub-agents per side, then a comparison synth.",
      origin: {
        task: "Compare the following two things side by side using web sources. For each side, run research.multiperspective (mainstream + critical + recent). Then write a balanced comparison: trade-offs, hidden costs, contexts each is best in. Cite every claim with [N] including which side it supports.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Fact-check a claim",
      description: "Targeted web search for a specific claim. Pulls supporting AND opposing evidence in parallel, then states whether the claim holds, partially holds, or doesn't.",
      origin: {
        task: "Fact-check the following claim against the live web. Run TWO parallel web searches: one for supporting evidence (the claim phrased as fact), one for opposing evidence (the claim negated or with words like 'debunk', 'false', 'no evidence'). Fetch top sources from both. Report: VERDICT (supported / partially supported / contested / unsupported), key evidence with [N] citations on both sides, and the strongest counter-argument you found.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Find primary sources",
      description: "Hunt for the ORIGINAL sources behind a topic — official docs, papers, press releases, primary datasets — rather than secondary commentary.",
      origin: {
        task: "Find primary sources on the following topic using web search. Prioritise: official documentation, academic papers, government / regulatory filings, press releases from the source, raw datasets. Avoid commentary, opinion pieces, and aggregator summaries unless they cite primary work. For each primary source, give the URL and a one-sentence summary of what it actually says (not what others say about it). Capture as a sources-only note in 0-Inbox/.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Topic landscape map",
      description: "Build a map of a topic: key players, terminology, recent developments, open debates. Wide web sweep, structured output.",
      origin: {
        task: "Map the landscape of the following topic from the live web. Output sections: 1) Key players (people, companies, projects), 2) Core terminology with one-line definitions, 3) Recent developments (last 12 months), 4) Open debates / contested points. Use research.multiperspective with perspectives='mainstream, practitioner, recent, academic'. Cite every player and claim with [N].",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Vault + web bridge",
      description: "Reads what your vault already knows about a topic, identifies the gaps, then uses the live web to fill ONLY those gaps. Captures the bridge as a permanent zettel.",
      origin: {
        task: "Bridge the vault and the live web on the following topic. Step 1: search the vault exhaustively, summarise what it already knows. Step 2: identify the specific gaps or open questions. Step 3: run targeted web searches to answer ONLY those gaps. Step 4: write a brief 'Bridge note' citing both vault sources as [vault:path] and web sources as [N]. Save as a 2-Permanent/ zettel.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],

  "marketing-manager": () => [
    {
      title: "Positioning sprint",
      description: "Take a product or feature and produce a positioning statement, target segment, and three message variants for testing.",
      origin: {
        task: "Run a positioning sprint on the following product/feature. Output: 1) One-line positioning (audience + problem + outcome + why-us). 2) Target segment with one objection each segment has. 3) Three message variants — Promise / Proof / Provocation — each with the audience it suits and a one-line test plan (channel, ad copy, success metric).",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Campaign brief",
      description: "Turn a goal into a campaign brief — audience, hook, channels, assets needed, success metric, dates.",
      origin: {
        task: "Draft a campaign brief for the following goal. Output sections: Audience (who, where, what they care about) / Insight (why now) / Hook (one sentence) / Channels (ranked, with rationale) / Assets needed (list) / Success metric (specific, measurable) / Timeline (dated). Skip what you don't know — flag it in 'Inputs still needed'.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Landing page copy",
      description: "Customer-led landing page copy — hero, three value blocks, primary CTA, plus a second variant.",
      origin: {
        task: "Write landing page copy for the following product. Output: Hero headline + sub (one variant 'outcome-led', one variant 'pain-led'), three value-block headers each with a 1-2 sentence body, primary CTA copy. Audience-first language — name the outcome, not the feature. No jargon, no superlatives, no 'revolutionary'.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Email sequence (3-step)",
      description: "Three-email sequence for a campaign — each email named, with subject, hook, body and CTA.",
      origin: {
        task: "Write a 3-email sequence for the following campaign. For each email: Name (its job), Send-day (relative to the trigger), Subject line + alternate, Preview text, Body (under 120 words), CTA. Sequence purpose: 1) earn the open, 2) demonstrate the value, 3) ask for the action. Plain prose, no header noise.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Copy critique",
      description: "Critique existing marketing copy — what's vague, what's audience-mismatched, what to cut. Returns a rewrite.",
      origin: {
        task: "Critique the following marketing copy. Output: 1) Audience match — who this is for vs who it sounds aimed at. 2) Specificity — name the vague phrases and what they should be replaced with. 3) Cuts — phrases to delete. 4) Rewrite — your tightened version. Be direct; this is a critique, not a compliment.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],

  "software-engineer": () => [
    {
      title: "Investigate + fix a bug",
      description: "Read the relevant code, identify root cause, propose the smallest correct fix with a test plan.",
      origin: {
        task: "Investigate the following bug. Steps: 1) Read the relevant code using vault.search / github.read_repo to find the implicated files. 2) Identify the root cause (cite file paths and line numbers). 3) Propose the smallest correct fix as a diff sketch. 4) Test plan: what to run, what should pass, edge cases to check. 5) Blast radius: what else this might affect.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Code review on a diff/PR",
      description: "Senior-engineer review of a diff or PR — correctness, maintainability, security, performance.",
      origin: {
        task: "Review the following diff/PR. Use github.read_repo if a PR number is given. Output sections (only if you have something to say): Correctness / Maintainability / Security / Performance. For each finding, cite the file + line and propose the change. End with a verdict: APPROVE / APPROVE-WITH-CHANGES / REQUEST-CHANGES.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Architecture trade-off memo",
      description: "Compare two technical approaches for a real decision. Names trade-offs honestly, picks one.",
      origin: {
        task: "Write a trade-off memo for the following technical decision. Output: 1) The decision (one sentence). 2) Options (A and B, each with one-paragraph description). 3) Trade-off matrix (operability, performance, complexity, blast radius, reversibility). 4) Recommendation with the reason that mattered most. 5) What we'd verify before committing.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Repo orientation",
      description: "Read a repo and produce a senior-engineer orientation: what it does, how it's organised, where to start.",
      origin: {
        task: "Produce a senior-engineer orientation to the following repo. Use github.read_repo. Output: 1) Purpose (one sentence). 2) Stack (languages, frameworks, key libraries). 3) Architecture overview (entry points, main modules, data flow). 4) Where the interesting complexity lives. 5) First three files a new engineer should read, in order. Cite file paths.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],

  "operations-coordinator": () => [
    {
      title: "Turn a goal into an action plan",
      description: "Convert an ambiguous goal into a numbered plan — each step with owner, by-when, and done-means.",
      origin: {
        task: "Turn the following goal into an executable action plan. Output a numbered list. Each step has: Step / Owner / By when (specific date or N days from today) / Done means (the verification). End with 'Inputs still needed' — list what's unclear that's blocking execution.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Write a runbook",
      description: "Produce a runbook for a recurring operation — trigger, preconditions, numbered steps, verification, rollback.",
      origin: {
        task: "Write a runbook for the following operation. Output sections: Trigger (what causes this runbook to run) / Preconditions (what must be true first) / Steps (numbered, each executable without judgement) / Verification (how to confirm success) / Rollback (how to back out if it fails). Steps must be specific — no 'review settings' without naming WHICH setting.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Weekly schedule from priorities",
      description: "Take a list of priorities and produce a dated weekly schedule with realistic blocks.",
      origin: {
        task: "Take the following priorities and turn them into a dated weekly schedule. Today is the start of the week unless stated. Output: Mon-Fri (dated), each day with 2-4 named time blocks. Each block has Owner / Purpose / Output. Surface conflicts and overcommitment honestly; don't pretend everything fits.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Status report",
      description: "Write a clean status report — done, in-progress, blocked, next.",
      origin: {
        task: "Write a status report on the following work. Output sections: Done (this period) / In progress (with % complete and ETA) / Blocked (with what's blocking and who can unblock) / Next (this coming period). Be honest about slips. Each item is one line; if it needs a paragraph, it's a separate doc.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],

  "customer-success": () => [
    {
      title: "Draft a reply to a customer",
      description: "Read the customer's message, identify the real need, draft a reply that resolves it.",
      origin: {
        task: "Draft a customer reply. Steps: 1) Read the message and name the tone (frustrated / confused / excited / neutral). 2) Identify the underlying need (often different from the literal ask). 3) Draft a reply that opens with the right acknowledgment, resolves the real need, attaches a date to any commitment. 4) Flag any churn-risk or expansion-signal language separately. No macro-speak.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Health-check a customer account",
      description: "Read the recent thread + usage signals and produce a customer health summary.",
      origin: {
        task: "Health-check the following customer account based on the messages / data provided. Output: 1) Sentiment trajectory (last 30/60/90 days). 2) Outstanding issues (with age + last touch). 3) Churn signals (specific phrases or behaviours, with quotes if available). 4) Expansion signals. 5) Recommended next action (specific — message, call, escalation) with a date.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Renewal preparation memo",
      description: "Build the renewal case from the account's history — wins, issues, expansion path.",
      origin: {
        task: "Prepare a renewal memo for the following account. Output sections: 1) Wins this term (with specific outcomes the customer would recognise). 2) Issues (open + resolved, with how they were handled). 3) Expansion path (what they'd benefit from next, with the trigger that would justify it). 4) Risks (what could push them to not renew). 5) Recommended renewal motion (timing, ask, fallback).",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Onboarding plan for a new customer",
      description: "Personalised onboarding plan grounded in the customer's stated goals + segment.",
      origin: {
        task: "Build an onboarding plan for the following new customer. Output: 1) Their goal in their words. 2) Week 1: 'first value' moment + concrete steps to get there. 3) Week 2-4: habits to form + checkpoints. 4) Day-30 success criteria — what they'll be doing if onboarding worked. 5) Health signals to watch + intervention plan if they slip.",
        createdAt: new Date().toISOString(),
      },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],

  // ───────── Media-production roster (MiniMax media.* primitives) ─────────
  // Each template's task names the media.* tool explicitly so the planner wires
  // it. They degrade gracefully — without a MINIMAX_API_KEY the tool returns a
  // friendly "not configured" and the persona still delivers the script/prompt.
  "voice-producer": () => [
    {
      title: "Narrate this as audio",
      description: "Turn any text into a clean spoken script and synthesise it to an audio file with text-to-speech.",
      origin: { task: "Rewrite the following text as a clean SPOKEN script (short sentences, contractions, no markdown read aloud), then use media.tts to synthesise it to audio. Pick a fitting voice and emotion, and state your choice. Return BOTH the script and the audio file path.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Audio briefing from notes",
      description: "Condense notes/a report into a listenable 60-90 second briefing and produce the narration audio.",
      origin: { task: "Condense the following into a 60-90 second SPOKEN briefing — only what matters, written for the ear. Then use media.tts to narrate it (neutral, clear voice). Return the script + the audio path, and note anything you trimmed.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Welcome / IVR voice prompt",
      description: "Write and voice a short phone-menu or welcome prompt — warm, clear, and short.",
      origin: { task: "Write a short phone/IVR or welcome voice prompt for the following scenario. Keep it under 20 seconds spoken, warm and clear, spelling out anything that could be misheard. Then use media.tts with a warm voice to produce the audio. Return the script + audio path.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],
  "video-producer": () => [
    {
      title: "Short social clip",
      description: "Write a tight visual prompt and generate a short vertical clip for social (Reels/TikTok/Shorts).",
      origin: { task: "Create a short social video for the following idea. Write a tight visual prompt (subject, action, setting, camera, mood), state the channel + aspect (default 9:16) and the first-second hook, then use media.video to generate it. Return the prompt + the video URL.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Product teaser from a brief",
      description: "Storyboard a multi-shot product teaser, then render the key shot.",
      origin: { task: "Storyboard a product teaser for the following brief: a numbered shot list, each shot with its own concrete visual prompt. Then use media.video to render the single most important shot. Return the full storyboard, the prompt you rendered, and the video URL.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Animate an image",
      description: "Take a supplied image as the first frame and generate a short motion clip from it.",
      origin: { task: "Using the supplied image as the first frame, write a motion prompt describing how the scene should move, then use media.video with that image as first_frame_image to generate a short clip. If no image was supplied, ask for one. Return the prompt + the video URL.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],
  "music-producer": () => [
    {
      title: "Brand jingle",
      description: "Translate a brand brief into a music prompt and generate a short jingle.",
      origin: { task: "Compose a short brand jingle for the following brief. Write a concrete music prompt (genre, tempo/bpm, instruments, mood), add short singable lyrics if the brief wants vocals, then use media.music to generate it. Return the prompt (and lyrics) + the audio path.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Background track / bed",
      description: "Produce a loopable instrumental bed matched to a placement (podcast, hold music, ad).",
      origin: { task: "Produce a loopable instrumental background track for the following placement. Specify genre, tempo, instruments, and energy matched to the use, keep it unobtrusive, then use media.music (instrumental, no lyrics) to generate it. Return the prompt + the audio path.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Theme track from a mood",
      description: "Turn a one-line mood/genre into a finished theme track.",
      origin: { task: "Turn the following mood/genre description into a finished theme track. Expand it into a precise music prompt (genre, tempo, key/mood, instruments, feel), then use media.music to generate it. Return the prompt + the audio path, and suggest one variation worth trying.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],
  "multimedia-producer": () => [
    {
      title: "Full content package",
      description: "From one brief: script + voiceover + video clip + music bed, with an assembly note.",
      origin: { task: "Produce a complete content package for the following brief. 1) A tight content plan (hook, message, CTA, format + length). 2) The script. 3) A voiceover via media.tts. 4) A video clip via media.video. 5) A music bed via media.music. Keep the tone cohesive across all three. End with an ASSEMBLY note (what plays when, where music ducks under voice, where the CTA lands). Return every prompt + every asset path/URL.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Social ad (voice + video)",
      description: "A short ad: scripted voiceover over a generated video clip, tonally matched.",
      origin: { task: "Make a short social ad for the following product/offer. Write a punchy script, narrate it with media.tts, and generate a matching vertical video clip with media.video (state aspect + first-second hook). Keep voice and visuals on-brand. Return the script, both prompts, and both asset paths, plus a one-line note on how they overlay.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Explainer with narration + music",
      description: "An explainer: narrated script over a music bed, optionally with a visual.",
      origin: { task: "Build a short explainer for the following topic. Write a clear spoken script, narrate it with media.tts, and produce a soft instrumental bed with media.music that sits under the voice. Optionally generate a supporting visual with media.video. Return the script, all prompts, all asset paths, and an assembly note on levels (voice over a quiet bed).", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],
  "aiia-finance": () => [
    {
      title: "Aiia financial dashboard (year)",
      description: "Pull the Aiia yearly dashboard and explain the headline numbers, sourced.",
      origin: { task: "Read the company's Aiia financial dashboard for the requested year (default to the current year if none is given). Use connector.call on the 'Aiia Finance' connector: GET /api/agent/dashboard?year=YYYY. Then explain the headline figures in plain cash terms — lead with the top number, then the breakdown, then what it means. Cite the endpoint + year for every figure. If the connector errors or returns no data, say so and stop rather than estimating.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Aiia finance overview",
      description: "Fetch the Aiia agent/finance overview and summarise the current position.",
      origin: { task: "Fetch the Aiia finance overview via connector.call on the 'Aiia Finance' connector: GET /api/agent. Summarise the current financial position from what Aiia returns — key balances/metrics first, then notable movements. Ground every number in the Aiia response and cite it. If Aiia is unreachable, report that plainly.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
    {
      title: "Year-over-year from Aiia",
      description: "Compare two years from the Aiia dashboard and explain the variance.",
      origin: { task: "Compare the company's finances across the two years the customer names (or the current year vs. the prior year). Use connector.call on the 'Aiia Finance' connector twice: GET /api/agent/dashboard?year=YYYY for each year. Present a side-by-side of the key lines with absolute and percentage variance, and a one-line explanation per material change. Cite the endpoint + each year. Do not estimate any figure Aiia can provide.", createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    },
  ],
  "hr-manager": () => [
    { title: "Onboarding 30-60-90 plan", description: "A structured onboarding plan with checklists, owners, and timing.", origin: { task: "Build a 30-60-90 day onboarding plan for the role/new hire described. Include concrete checklists (access, training, intros, first deliverables) with an owner and timing for each item.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "HR policy draft", description: "A clear HR policy with scope, the rule, and how it's applied.", origin: { task: "Draft a clear HR policy for the topic described (e.g. leave, remote work, code of conduct). Cover purpose, scope (who it applies to), the policy itself, and how it's applied/enforced. Flag anything that needs legal sign-off.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Performance review pack", description: "A review template: goals, evidence prompts, feedback structure, rating rubric.", origin: { task: "Create a performance-review pack for the role described: goal-setting structure, evidence prompts, a specific-feedback format (situation/behaviour/impact), and a clear rating rubric.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "accountant": () => [
    { title: "Invoice / statement", description: "A professional invoice or account statement, tied out.", origin: { task: "Draft a professional invoice or account statement from the details provided: line items, quantities, rates, subtotals, tax, terms, and a total that ties out to the cent.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Reconciliation", description: "Match two sets of records and explain every discrepancy.", origin: { task: "Reconcile the two sets of records provided (e.g. bank vs ledger). List matched items, then every discrepancy with its amount and likely cause, and state the closing difference. Don't paper over anything that doesn't tie.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Financial statement summary", description: "A P&L / cash-position summary from real figures.", origin: { task: "Prepare a P&L or cash-position summary from the figures provided. Lead with the headline number, then the make-up by line, then anything unusual. Tie out to the cent and state assumptions about the chart of accounts.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "it-support": () => [
    { title: "Fix-it runbook", description: "A step-by-step guide for a non-technical user.", origin: { task: "Write a step-by-step fix-it guide for the IT issue described, for a non-technical user: numbered steps, the expected result after each, and what to do if a step fails. Start with the safe, reversible fix.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Access provisioning plan", description: "Least-privilege access for a request, with revoke steps.", origin: { task: "Draft an access-provisioning plan for the request described, least-privilege: what to grant, to whom, for how long, the approval needed, and exactly how to revoke it later.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Device setup checklist", description: "A secure device/software setup checklist.", origin: { task: "Create a secure device and software setup checklist for the scenario described, with secure defaults (disk encryption, MFA, updates, least-privilege accounts) and a verification step for each.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "procurement": () => [
    { title: "RFQ / RFP draft", description: "A clear request for quote with specs and evaluation criteria.", origin: { task: "Draft an RFQ/RFP for the goods or service described: unambiguous specs, quantities, timeline, delivery terms, and the evaluation criteria so quotes come back comparable.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Vendor comparison", description: "Compare quotes on total cost of ownership and recommend.", origin: { task: "Compare the vendors/quotes provided on total cost of ownership (price + terms + support + switching cost + risk) as a table, then recommend one with the reasoning. Flag any single-source risk.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Negotiation brief", description: "Levers, target, and walk-away for a purchase.", origin: { task: "Prepare a negotiation brief for the purchase described: the levers you can pull, your target outcome, the walk-away (BATNA), and a concession plan. Never present a single option as the only one.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "sdr": () => [
    { title: "Cold outreach sequence", description: "A multi-touch email + LinkedIn sequence that earns a reply.", origin: { task: "Write a 3-5 touch cold outreach sequence (email + LinkedIn) for the prospect/ICP described. Lead with their likely problem, make each touch a fresh angle (not a repeated nag), and keep each message short and easy to reply to.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Lead qualification", description: "Qualify a lead honestly, then next step or disqualify.", origin: { task: "Qualify the lead described against BANT/MEDDIC-light (budget, authority, need, timing/metrics). State the fit, what's missing, and either the recommended next step or an honest disqualify with the reason.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Prospect research + opener", description: "ICP-fit research and a tailored first touch.", origin: { task: "Research the prospect/account described against the ICP: relevant hooks, likely pain points, and a tailored opener that leads with their problem, not the product.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "compliance": () => [
    { title: "Compliance check", description: "Check a process/policy against rules, with gaps + remediation.", origin: { task: "Check the process or policy described against applicable policy/regulation. List each requirement, whether it's met, the evidence that proves it, and any gaps with concrete remediation. Distinguish 'required by law' from 'good practice'.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Risk register", description: "Scored risks with owners and mitigations.", origin: { task: "Build a risk register for the area described. For each risk: a clear description, likelihood × impact score, an owner, and a mitigation. No orphan risks.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Audit prep checklist", description: "Controls to evidence and documents to gather.", origin: { task: "Create an audit-prep checklist for the area described: the controls to evidence, the documents/records to gather, who owns each, and the likely gaps to fix before the audit.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "communications": () => [
    { title: "Press release", description: "An inverted-pyramid release with a quotable line.", origin: { task: "Write a press release for the announcement described: inverted pyramid (most important first), a real quotable executive line, a boilerplate, and only verifiable claims.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Internal announcement", description: "A clear, on-message change announcement.", origin: { task: "Draft an internal announcement of the change described — clear and on-message, leading with what it means for the reader, then the detail, then where to get help.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Crisis holding statement + Q&A", description: "Acknowledge, facts, action, next update — no speculation.", origin: { task: "Draft a holding statement plus a short Q&A for the situation described: acknowledge it, state only confirmed facts, the action being taken, and when the next update comes. No speculation or premature blame.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "office-manager": () => [
    { title: "Travel itinerary", description: "A clear itinerary with times, addresses, and a fallback.", origin: { task: "Build a clear travel itinerary from the trip details provided: each leg with times, addresses, confirmation numbers, and a fallback option. Note the spend and a cheaper alternative where one exists.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Event run-sheet", description: "End-to-end event/meeting logistics with a budget note.", origin: { task: "Plan the event or meeting described end to end: a run-sheet with times, owners, logistics, supplies/catering, AV, and a budget note. Include a contingency for the most likely thing to go wrong.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Office process doc", description: "A repeatable process for a recurring office task.", origin: { task: "Document a repeatable process for the recurring office task described: steps, owners, frequency, and a cost-conscious option. Make it something a new person could follow.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "business-analyst": () => [
    { title: "Business requirements doc (BRD)", description: "Testable functional + non-functional requirements.", origin: { task: "Write a business requirements document for the need described: the business need (why), scope, functional and non-functional requirements — each specific and testable — plus assumptions and open questions.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "As-is / to-be process map", description: "Current vs future process and the explicit gap.", origin: { task: "Map the as-is and to-be process for the workflow described (steps, actors, decisions), then state the explicit gap/changes between them and what each change requires.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "User stories + acceptance criteria", description: "Stories with clear, testable acceptance criteria.", origin: { task: "Turn the feature or need described into user stories ('As a … I want … so that …') each with clear, testable acceptance criteria, plus assumptions and open questions.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "learning-development": () => [
    { title: "Training curriculum", description: "Outcomes-first modules with practice and assessment.", origin: { task: "Design a training curriculum for the topic/role described: start from the learning outcomes, then modules with examples and practice, and an assessment that tests each outcome. State how you'd measure it worked.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Quiz / assessment", description: "Questions that test the outcome, with answer rationale.", origin: { task: "Create an assessment for the topic described that tests the stated learning outcome: a mix of question types, the correct answers, and why each distractor is wrong.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Workshop facilitator guide", description: "Outcomes, timed agenda, activities, and materials.", origin: { task: "Write a workshop facilitator guide for the session described: learning outcomes, a timed agenda, activities with instructions, materials needed, and facilitation notes.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "project-manager": () => [
    { title: "Project plan", description: "Milestones, dependencies, owners, and dates.", origin: { task: "Build a project plan for the initiative described: milestones, the dependencies between them, an owner and date for each, and the critical path. No orphan work, no undated TBDs.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Status report", description: "RAG status, progress, risks, and asks.", origin: { task: "Write a project status report from the update provided: overall RAG status, what changed since last time, risks/blockers with mitigations, and what you need from whom. Honest, not green-washed.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "RAID log", description: "Risks, assumptions, issues, dependencies — each owned.", origin: { task: "Create a RAID log for the project described: risks, assumptions, issues, and dependencies — each with an owner and a next action. Surface the blockers early.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
  "logistics": () => [
    { title: "Shipment / fulfillment plan", description: "Route, schedule, tracking, and the cost/time trade-off.", origin: { task: "Plan the shipment or fulfillment described: carrier/route options, the schedule, how it's tracked, and the cost vs time trade-off with a recommendation.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Inventory / reorder analysis", description: "Reorder points and stockout/overstock risk vs lead times.", origin: { task: "Analyse the stock situation described: reorder points, stockout and overstock risk against lead times and demand, and a reorder recommendation with quantities and timing.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
    { title: "Logistics exception resolution", description: "Impact, options, and a recommended action with comms.", origin: { task: "Resolve the logistics exception described (delay, damage, or shortage): state the impact, the options, a recommended action, and the comms to send affected parties.", createdAt: new Date().toISOString() }, plan: { steps: [], summary: undefined, waves: [] }, runCount: 0 },
  ],
};

// The id namespace for persona-derived templates: `custom-<personaId>-...`.
// We use this to find and remove templates that belong to a persona.
function templateIdPrefix(personaId: string): string {
  return `custom-${personaId}-`;
}

// Generate the full template set for a persona — curated where available,
// generic otherwise. Returns the list without persisting; the caller decides
// when to save.
export function buildStarterTemplates(persona: Persona): CustomTemplate[] {
  const curatedBuilder = CURATED[persona.id];
  if (curatedBuilder) {
    const partials = curatedBuilder(persona.id);
    return partials.map(p => ({
      ...p,
      id: `${templateIdPrefix(persona.id)}${slugify(p.title).slice(0, 40)}`,
      role: "Custom",
    }));
  }
  // Generic path — one template per responsibility, plus a free-form
  // "general task" that's always available. Every persona ends up with at
  // least one template even when responsibility extraction returned nothing.
  const out: CustomTemplate[] = [];
  for (const resp of persona.responsibilities.slice(0, 5)) {
    const task = `As a ${persona.role}, ${resp.toLowerCase().replace(/\.$/, "")}.`;
    out.push({
      id: `${templateIdPrefix(persona.id)}${slugify(resp).slice(0, 40)}`,
      role: "Custom",
      title: resp.length > 80 ? resp.slice(0, 77) + "…" : resp,
      description: `Persona-derived starter task for "${persona.name}".`,
      origin: { task, createdAt: new Date().toISOString() },
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    });
  }
  // Universal fallback — always available as a quick prompt, frames the
  // task in the persona's voice without needing a specific responsibility.
  out.push({
    id: `${templateIdPrefix(persona.id)}ask-anything`,
    role: "Custom",
    title: `Ask ${persona.name} anything`,
    description: `Free-form task framed through the ${persona.role} role. Empty plan — re-plans against the persona system prompt each run.`,
    origin: { task: `As a ${persona.role}, respond to the following task in role:`, createdAt: new Date().toISOString() },
    plan: { steps: [], summary: undefined, waves: [] },
    runCount: 0,
  });
  return out;
}

// Boot-time pass.
//
//   • Built-in personas (id has an entry in CURATED) ALWAYS refresh against
//     the latest curated set. Run history is preserved per template id via
//     refreshPersonaTemplates. This lets us improve the platform's starter
//     templates and have those improvements land on the next server boot
//     without the user having to click anything.
//   • Custom personas only get templates generated when they're missing —
//     we don't overwrite a user's customisations.
export function ensureAllPersonasHaveTemplates(personas: Persona[]): { personaId: string; added: number; refreshed?: boolean }[] {
  const summary: { personaId: string; added: number; refreshed?: boolean }[] = [];
  for (const persona of personas) {
    const isBuiltin = CURATED[persona.id] !== undefined;
    if (isBuiltin) {
      const r = refreshPersonaTemplates(persona);
      const changed = r.added + r.removed;
      if (changed > 0) summary.push({ personaId: persona.id, added: r.added, refreshed: true });
      continue;
    }
    const existing = listPersonaTemplates(persona.id);
    if (existing.length > 0) continue;
    const fresh = buildStarterTemplates(persona);
    for (const t of fresh) saveCustomTemplate(t);
    if (fresh.length > 0) summary.push({ personaId: persona.id, added: fresh.length });
  }
  return summary;
}

// List the custom templates that were generated for a given persona. Used by
// the UI to show counts and by refresh to know what to remove first.
export function listPersonaTemplates(personaId: string): CustomTemplate[] {
  const prefix = templateIdPrefix(personaId);
  return loadCustomTemplates().filter(t => t.id.startsWith(prefix));
}

// Refresh = remove old persona-derived templates, generate fresh ones from
// current responsibilities. PRESERVES the runCount/lastRunAt of templates
// whose id survives (e.g. responsibility text unchanged) so the user's usage
// history isn't reset on a no-op refresh.
export function refreshPersonaTemplates(persona: Persona): { kept: number; added: number; removed: number; ids: string[] } {
  const old = listPersonaTemplates(persona.id);
  const oldById = new Map(old.map(t => [t.id, t]));
  const fresh = buildStarterTemplates(persona);
  const freshIds = new Set(fresh.map(t => t.id));

  let kept = 0;
  let added = 0;
  let removed = 0;

  // Carry over runCount + lastRunAt for templates with matching ids.
  for (const f of fresh) {
    const prior = oldById.get(f.id);
    if (prior) {
      f.runCount = prior.runCount;
      f.lastRunAt = prior.lastRunAt;
      kept++;
    } else {
      added++;
    }
    saveCustomTemplate(f);
  }
  // Drop old templates that aren't in the fresh set.
  for (const o of old) {
    if (!freshIds.has(o.id)) {
      if (deleteCustomTemplate(o.id)) removed++;
    }
  }
  return { kept, added, removed, ids: fresh.map(t => t.id) };
}

// Remove every template owned by a persona — used when the persona is deleted.
export function purgePersonaTemplates(personaId: string): number {
  const owned = listPersonaTemplates(personaId);
  let removed = 0;
  for (const t of owned) if (deleteCustomTemplate(t.id)) removed++;
  return removed;
}
