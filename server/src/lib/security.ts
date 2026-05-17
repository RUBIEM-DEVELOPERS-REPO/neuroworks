// Conservative secret/risk detector. Each finding has a severity that the
// caller uses to decide whether to refuse the write (high), redact it
// (medium), or just log it (low). The patterns are intentionally specific —
// we'd rather miss a fuzzy match than false-positive on user prose.
export type SecurityFinding = {
  type: string;
  match: string;
  severity: "high" | "medium" | "low";
  reason: string;
};

export type SecurityKind = "note" | "code" | "commit-message";

export function scanForSecurityRisks(content: string, kind: SecurityKind = "note"): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const seen = new Set<string>();
  const add = (f: SecurityFinding) => {
    const key = `${f.type}:${f.match}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  // High-severity: real-looking secrets. The prefixes are the strongest signal
  // because the issuers document them. Length constraints cut false positives
  // on prose. New patterns: keep them precise — anchored prefix + length lower
  // bound — or they'll fire on README excerpts.
  const SECRET_PATTERNS: { type: string; re: RegExp; reason: string }[] = [
    { type: "github_pat", re: /\bghp_[A-Za-z0-9]{36,}\b/g, reason: "GitHub personal access token" },
    { type: "github_fine_grained", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, reason: "GitHub fine-grained PAT" },
    { type: "openai_key", re: /\bsk-[A-Za-z0-9]{20,}\b/g, reason: "OpenAI API key" },
    { type: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, reason: "Anthropic API key" },
    { type: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/g, reason: "AWS access key id" },
    { type: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, reason: "Google API key" },
    { type: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, reason: "Slack token" },
    { type: "private_key_pem", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, reason: "PEM private key block" },
    { type: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, reason: "JWT-shaped token" },
  ];
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(content))) {
      add({ type: p.type, match: m[0], severity: "high", reason: p.reason });
    }
  }

  // Medium: suspicious URLs (raw IPs, dodgy TLDs).
  const URL_RE = /\bhttps?:\/\/([^\s)\]"']+)/gi;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(content))) {
    const host = m[1].split("/")[0].toLowerCase();
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    const tld = host.split(".").pop() ?? "";
    const dodgyTlds = new Set(["tk", "ml", "ga", "cf", "click", "zip", "mov"]);
    if (isIp) add({ type: "ip_url", match: m[0], severity: "medium", reason: "URL points at a raw IP" });
    else if (dodgyTlds.has(tld)) add({ type: "dodgy_tld", match: m[0], severity: "medium", reason: `URL TLD .${tld} is commonly abused` });
  }

  // Low: command-injection-shaped patterns when the content is code or a
  // commit message. Notes get a pass — prose often discusses these patterns.
  if (kind === "code" || kind === "commit-message") {
    const INJECT_RES = [
      { re: /\b(?:rm\s+-rf\s+\/|:\s*\(\s*\)\s*\{)/g, reason: "destructive shell pattern" },
      { re: /\b(?:curl|wget)\s+\S+\s*\|\s*(?:bash|sh|zsh)\b/g, reason: "remote-pipe-execute" },
    ];
    for (const p of INJECT_RES) {
      p.re.lastIndex = 0;
      while ((m = p.re.exec(content))) add({ type: "command_injection", match: m[0], severity: "low", reason: p.reason });
    }
  }
  return out;
}

// Run findings through a redactor — replaces high-severity matches with
// `[REDACTED:type]`. Low/medium findings are left in place so the caller can
// decide what to do with them (warn, log, refuse).
export function redactHighSeverity(content: string, findings: SecurityFinding[]): string {
  let out = content;
  for (const f of findings) {
    if (f.severity === "high" && f.match) {
      out = out.split(f.match).join(`[REDACTED:${f.type}]`);
    }
  }
  return out;
}
