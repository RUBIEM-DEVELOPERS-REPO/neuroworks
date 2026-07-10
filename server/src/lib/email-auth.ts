// Inbound email authentication — shared by the IMAP poll (cryptographic DKIM/
// DMARC verification via mailauth) and the Mailjet Parse webhook (reads the MX-
// stamped Authentication-Results header). Both reduce to one verdict:
//   "pass"    → an authenticated signal aligns with the From domain.
//   "fail"    → an explicit failure / spoof (aligned auth expected but absent).
//   "unknown" → can't tell (no policy / no signature / lib error).
// The caller gates on it: "fail" is always rejected; "unknown" is rejected only
// when NEUROWORKS_EMAIL_REQUIRE_AUTH=strict, otherwise allowed (then the sender
// allow-list is the remaining gate).

export type AuthVerdict = "pass" | "fail" | "unknown";

function aligned(signDomain: string, fromDomain: string): boolean {
  const d = (signDomain || "").toLowerCase();
  if (!d || !fromDomain) return false;
  return d === fromDomain || fromDomain.endsWith("." + d) || d.endsWith("." + fromDomain);
}

// Cryptographic verification of the raw RFC822 message. No SMTP client IP is
// available from IMAP, so SPF can't be evaluated — but DMARC passes on aligned
// DKIM alone (which is how Gmail/Outlook etc. authenticate), so DKIM alignment
// drives the verdict. Validated against a real Gmail message: dmarc=pass,
// dkim.results=[{result:"pass",signingDomain:"gmail.com"}].
export async function verifyInboundDkim(rawSource: Buffer | string, fromAddr: string): Promise<AuthVerdict> {
  const fromDomain = (fromAddr.split("@")[1] ?? "").toLowerCase();
  if (!fromDomain) return "fail";
  let res: any;
  try {
    const mailauth: any = await import("mailauth");
    const authenticate = mailauth.authenticate ?? mailauth.default?.authenticate;
    if (typeof authenticate !== "function") return "unknown";
    res = await authenticate(rawSource, { sender: fromAddr, mta: "neuroworks" });
  } catch {
    return "unknown"; // verification error → don't hard-fail legit mail
  }
  // DMARC requires an aligned DKIM (or SPF) pass, so it's the strongest single
  // signal when the From domain publishes a policy (gmail/outlook/etc. do).
  const dmarc = res?.dmarc?.status?.result;
  if (dmarc === "pass") return "pass";
  if (dmarc === "fail") return "fail";
  // No DMARC policy on the From domain → fall back to an aligned-DKIM check.
  const results = res?.dkim?.results;
  if (Array.isArray(results) && results.length > 0) {
    let alignedPass = false, anyFail = false;
    for (const r of results) {
      const result = r?.status?.result;
      const dom = r?.signingDomain ?? r?.status?.header?.d ?? "";
      if (result === "pass" && aligned(dom, fromDomain)) alignedPass = true;
      else if (result === "fail" || result === "permfail" || result === "policy") anyFail = true;
    }
    if (alignedPass) return "pass";
    if (anyFail) return "fail";
  }
  return "unknown";
}

// Header-based verdict for the Mailjet Parse webhook: the receiving MX stamps an
// `Authentication-Results` header with the real SPF/DKIM result; we require the
// authenticated domain to align with the claimed From domain.
export function evaluateAuthResultsHeader(headers: Record<string, any>, fromAddr: string): AuthVerdict {
  let ar = "";
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === "authentication-results") { ar = Array.isArray(v) ? v.join(" ") : String(v); break; }
  }
  if (!ar) return "unknown";
  const lc = ar.toLowerCase();
  const fromDomain = (fromAddr.split("@")[1] ?? "").toLowerCase();
  if (!fromDomain) return "fail";

  const dkimPass = /\bdkim=pass\b/.test(lc);
  const dkimDomains = [...lc.matchAll(/header\.(?:d|i)=@?([a-z0-9.-]+)/g)].map(m => m[1]);
  const dkimAligned = dkimPass && dkimDomains.some(d => aligned(d, fromDomain));

  const spfPass = /\bspf=pass\b/.test(lc);
  const spfDomains = [...lc.matchAll(/smtp\.(?:mailfrom|helo)=(?:[^@\s]*@)?([a-z0-9.-]+)/g)].map(m => m[1]);
  const spfAligned = spfPass && spfDomains.some(d => aligned(d, fromDomain));

  if (dkimAligned || spfAligned) return "pass";
  if (/\bdkim=fail\b/.test(lc) || /\bspf=fail\b/.test(lc) || /\bspf=softfail\b/.test(lc) || dkimPass || spfPass) return "fail";
  return "unknown";
}
