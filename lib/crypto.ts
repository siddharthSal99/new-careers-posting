import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// ---------- Passwords: scrypt with a random 16-byte salt per user ----------

const SCRYPT = { N: 32768, r: 8, p: 1, keyLen: 32 };
// scrypt needs 128 * N * r bytes (32 MiB here); Node's default cap is exactly 32 MiB, so raise it.
const MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keyLen, { ...opts, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns "scrypt$N$r$p$salt$hash" (salt and hash base64), so parameters can change later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keyLen, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash of a random password, used so a login for an unknown email takes as long as one for a known email.
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

// ---------- Secrets at rest: AES-256-GCM with ENCRYPTION_KEY ----------

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set on the server.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32).");
  return key;
}

export function encryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypts a secret. `context` (e.g. "user:12:anthropic") is bound in as associated data,
 * so a ciphertext copied onto another user's row won't decrypt.
 * Format: v1.<iv>.<auth tag>.<ciphertext>, base64url.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string, context: string): string {
  const [version, iv, tag, ct] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("unrecognized secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// ---------- Session tokens ----------

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
