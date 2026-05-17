// Security gates — small, focused checks applied at the boundary of any
// tool that can read arbitrary disk paths or fetch arbitrary URLs. The LLM
// drives the args; prompt-injection (a malicious web page tricks the model
// into reading /etc/passwd or hitting the AWS metadata service) is a real
// threat surface and these gates harden the perimeter.
//
// Each gate has an explicit opt-out env so a power user with genuine need
// (reading an .env file for debugging, fetching localhost from a job) can
// disable it. Default is locked-down.

import { resolve, basename } from "node:path";

// Path patterns that look like they target known sensitive files. Matched
// against the FULL resolved path so an LLM that hands us "../../.env" gets
// normalized first. Conservative — focuses on patterns where false positives
// are rare (the named filename is unmistakably sensitive).
const SENSITIVE_PATH_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(?:^|[\\/])\.env(?:\.\w+)?$/i, reason: ".env files often contain API keys and secrets" },
  { pattern: /(?:^|[\\/])\.ssh[\\/]/i, reason: "SSH key directory" },
  { pattern: /(?:^|[\\/])\.gnupg[\\/]/i, reason: "GnuPG keyring directory" },
  { pattern: /(?:^|[\\/])\.aws[\\/](?:credentials|config)$/i, reason: "AWS credentials file" },
  { pattern: /(?:^|[\\/])\.kube[\\/]config$/i, reason: "Kubernetes config (cluster credentials)" },
  { pattern: /(?:^|[\\/])\.docker[\\/]config\.json$/i, reason: "Docker registry credentials" },
  { pattern: /(?:^|[\\/])\.npmrc$/i, reason: "npm auth tokens" },
  { pattern: /(?:^|[\\/])\.pypirc$/i, reason: "PyPI auth tokens" },
  { pattern: /(?:^|[\\/])\.netrc$/i, reason: "netrc credentials" },
  { pattern: /id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$/i, reason: "SSH private/public key" },
  { pattern: /(?:^|[\\/])(?:Cookies|Login Data|Web Data|History|Bookmarks)$/i, reason: "Browser profile data (cookies, saved logins, history)" },
  { pattern: /(?:^|[\\/])(?:wallet|keystore)\.(?:dat|json)$/i, reason: "Crypto wallet file" },
  { pattern: /(?:^|[\\/])master\.key$/i, reason: "Application master key (Rails et al.)" },
  // Windows system / credential paths
  { pattern: /[\\/]Windows[\\/]System32[\\/]config[\\/](?:SAM|SECURITY|SYSTEM)$/i, reason: "Windows registry hive (credentials)" },
  // macOS keychain
  { pattern: /\.keychain(?:-db)?$/i, reason: "macOS Keychain" },
  // Generic POSIX
  { pattern: /^\/etc\/(?:shadow|sudoers|gshadow)$/i, reason: "POSIX credential file" },
];

export type SensitivePathCheck = {
  blocked: boolean;
  reason?: string;
  pattern?: string;
};

// Returns { blocked, reason } when the path matches a sensitive pattern AND
// the override env (CLAWBOT_FS_UNRESTRICTED=1) is NOT set. The override is
// explicit and global so a customer who needs to read their own .env for a
// debugging task can do so consciously — and the audit log shows when it
// was lifted.
export function checkSensitivePath(rawPath: string): SensitivePathCheck {
  if (process.env.CLAWBOT_FS_UNRESTRICTED === "1") return { blocked: false };
  let full: string;
  try { full = resolve(rawPath); } catch { return { blocked: false }; }
  for (const { pattern, reason } of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(full)) {
      return { blocked: true, reason, pattern: pattern.source };
    }
    // Also test against the basename — some patterns are filename-only.
    const name = basename(full);
    if (pattern.test(name)) {
      return { blocked: true, reason, pattern: pattern.source };
    }
  }
  return { blocked: false };
}

// Private/loopback IP detection. We block agent-driven fetches to these
// ranges by default — they're the SSRF attack surface (cloud metadata
// service, internal services, peer clawbot endpoints). Override via
// CLAWBOT_WEB_ALLOW_PRIVATE=1 for legitimate use cases like fetching from
// a local dev server.
//
// Covers:
//   • IPv4 private ranges (10/8, 172.16/12, 192.168/16)
//   • IPv4 loopback (127/8) and link-local (169.254/16 — AWS/Azure/GCP metadata)
//   • IPv6 loopback (::1), link-local (fe80::/10), unique-local (fc00::/7)
//   • localhost (any case)
//   • hostnames ending in .internal / .local
function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

const IPV4_PRIVATE_RANGES: { from: number; to: number; reason: string }[] = [
  { from: ipToInt("10.0.0.0")!,      to: ipToInt("10.255.255.255")!,   reason: "10/8 private range" },
  { from: ipToInt("172.16.0.0")!,    to: ipToInt("172.31.255.255")!,   reason: "172.16/12 private range" },
  { from: ipToInt("192.168.0.0")!,   to: ipToInt("192.168.255.255")!,  reason: "192.168/16 private range" },
  { from: ipToInt("127.0.0.0")!,     to: ipToInt("127.255.255.255")!,  reason: "loopback (127/8)" },
  { from: ipToInt("169.254.0.0")!,   to: ipToInt("169.254.255.255")!,  reason: "link-local incl. cloud metadata (169.254/16)" },
  { from: ipToInt("0.0.0.0")!,       to: ipToInt("0.255.255.255")!,    reason: "wildcard (0/8)" },
];

export type PrivateAddressCheck = {
  blocked: boolean;
  reason?: string;
  host?: string;
};

export function checkPrivateAddress(url: string): PrivateAddressCheck {
  if (process.env.CLAWBOT_WEB_ALLOW_PRIVATE === "1") return { blocked: false };
  let host = "";
  try {
    const u = new URL(url);
    // Block non-http(s) schemes outright — file:, gopher:, etc. are SSRF
    // vectors that bypass IP checks.
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { blocked: true, reason: `unsupported scheme ${u.protocol} (only http/https allowed)`, host: u.hostname };
    }
    host = u.hostname.toLowerCase();
  } catch {
    return { blocked: false };
  }
  if (!host) return { blocked: false };

  // Explicit localhost names.
  if (host === "localhost" || host === "localhost.localdomain" || host.endsWith(".localhost")) {
    return { blocked: true, reason: "localhost target", host };
  }
  // Internal-only TLDs.
  if (host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".intranet")) {
    return { blocked: true, reason: `internal-only TLD (.${host.split(".").pop()})`, host };
  }
  // IPv6 loopback / link-local / unique-local.
  if (host === "::1" || host === "[::1]" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return { blocked: true, reason: "IPv6 loopback/link-local/unique-local", host };
  }
  // IPv4 ranges.
  const asInt = ipToInt(host);
  if (asInt !== null) {
    for (const range of IPV4_PRIVATE_RANGES) {
      if (asInt >= range.from && asInt <= range.to) {
        return { blocked: true, reason: range.reason, host };
      }
    }
  }
  return { blocked: false };
}

// Convenience wrappers — throw with a clear, actionable message that the
// primitive's caller (the LLM, ultimately surfaced to the customer) can
// understand. We name the override env explicitly so a customer who needs
// to relax the gate knows exactly what to set.
export function assertSafeExternalPath(rawPath: string): void {
  const check = checkSensitivePath(rawPath);
  if (check.blocked) {
    throw new Error(
      `Refused to read "${rawPath}" — ${check.reason}. ` +
      `If you genuinely need this, set CLAWBOT_FS_UNRESTRICTED=1 in .env to lift the gate (logged).`,
    );
  }
}

export function assertSafePublicUrl(url: string): void {
  const check = checkPrivateAddress(url);
  if (check.blocked) {
    throw new Error(
      `Refused to fetch "${url}" — target ${check.host ?? "address"} is ${check.reason}. ` +
      `Agent web tools are restricted to the public internet to prevent SSRF. ` +
      `Set CLAWBOT_WEB_ALLOW_PRIVATE=1 in .env if you genuinely need to reach internal hosts.`,
    );
  }
}
