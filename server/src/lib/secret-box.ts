// Shared AES-256-GCM "secret box" for encrypting sensitive values at rest
// (integration tokens, DB connection strings). The key comes from
// CLAWBOT_SECRET_KEY (hex/base64/passphrase → SHA-256) or, if unset, a random
// key persisted at .neuroworks/.secret-key (mode 0600, gitignored). So a leaked
// integrations.json / data-sources.json is useless without the separate key.
//
// Format: "v1:<iv>:<tag>:<ciphertext>" (all base64). isEncrypted() lets callers
// transparently migrate legacy plaintext records on next write.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const KEY_PATH = resolve(CONFIG_DIR, ".secret-key");

let cachedKey: Buffer | null = null;
function secretKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = (process.env.CLAWBOT_SECRET_KEY ?? "").trim();
  if (fromEnv) {
    cachedKey = createHash("sha256").update(fromEnv).digest();
    return cachedKey;
  }
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (existsSync(KEY_PATH)) {
    cachedKey = Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "hex");
  } else {
    const k = randomBytes(32);
    writeFileSync(KEY_PATH, k.toString("hex"), { encoding: "utf8", mode: 0o600 });
    cachedKey = k;
  }
  return cachedKey;
}

export function isEncrypted(s: string): boolean {
  return typeof s === "string" && /^v1:/.test(s);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts[0] !== "v1" || parts.length !== 4) throw new Error("bad ciphertext");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
