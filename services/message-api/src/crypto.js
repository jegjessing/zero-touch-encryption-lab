import crypto from "node:crypto";

// Envelope encryption of the message body.
//
// AES-256-GCM gives us confidentiality AND integrity (the auth tag detects
// tampering). The key is 32 bytes, injected via a Kubernetes Secret as base64 —
// in a real Zerotouch deployment that key would live in Azure Key Vault and be
// rotated; it must never be placed in the code or the git history.
// The IV is 12 bytes (96 bits, yeah I can do the math :-) ), which is the recommended size for GCM.
// Each encryption uses a fresh random IV, which is stored alongside the ciphertext.
// The auth tag is 16 bytes (128 bits), which is the recommended size for GCM.
// The ciphertext, IV, and auth tag are all base64-encoded for storage in the DB.

const ALGO = "aes-256-gcm";

function loadKey() {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

export function encrypt(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

// Decrypt is needed for future use cases, e.g. if we want to read the message body back out to the client.
export function decrypt({ ciphertext, iv, authTag }) {
  const key = loadKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
