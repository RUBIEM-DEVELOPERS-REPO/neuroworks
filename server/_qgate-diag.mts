import { findPrimitive } from "./src/lib/primitives.js";
import { classifyDeliverable } from "./src/lib/deliverable.js";
const prim = findPrimitive("quality.check")!;
const cases: {label:string; task:string; answer:string; context?:string}[] = [
  { label: "conversational Q&A", task: "What's the difference between REST and GraphQL?",
    answer: "REST exposes multiple endpoints, each returning a fixed data shape, and you often over- or under-fetch. GraphQL exposes a single endpoint where the client specifies exactly the fields it wants in one query, reducing round-trips. REST is simpler to cache at the HTTP layer; GraphQL trades that for flexibility and needs its own caching strategy. Use REST for simple resource-oriented APIs and GraphQL when clients need varied nested data.", },
  { label: "persona finance answer", task: "Summarise our current financial position.", context: "Aria, AIIA Finance Officer",
    answer: "Based on the latest dashboard, revenue stands at R1.25m against R840k of expenses, leaving a net profit of about R410k. Cash on hand is R320k and outstanding receivables are R95k. The business is profitable and liquid, though the R95k in receivables is worth chasing.", },
  { label: "short direct answer", task: "Should we use Postgres or MongoDB for a transactional billing system?",
    answer: "Use Postgres. Billing is inherently relational and transactional — you need ACID guarantees, foreign keys, and strong consistency for money. MongoDB's flexible schema is a liability here. Postgres also gives mature tooling for audits and reconciliation.", },
];
for (const c of cases) {
  const cls = classifyDeliverable(c.context ? `${c.task}\n${c.context}` : c.task);
  const t0=Date.now();
  const r: any = await prim.handler({ task: c.task, answer: c.answer, ...(c.context?{context:c.context}:{}) });
  console.log(`RESULT|| ${c.label} | class=${cls} | pass=${r.pass} | score=${typeof r.score==="number"?r.score.toFixed(2):r.score} | fact_risk=${r.factuality_risk} | cite=${r.citation_coverage} | persona=${r.persona_fit} | ${Math.round((Date.now()-t0)/1000)}s`);
  if (r.issues?.length) console.log(`ISSUES|| ${r.issues.slice(0,4).join(" ; ")}`);
}
console.log("ALLDONE");
process.exit(0);
