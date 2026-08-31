import { test } from "node:test";
import assert from "node:assert/strict";

// A valid 32-byte key (base64) must exist before crypto.js is imported.
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const { encrypt, decrypt } = await import("../src/crypto.js");

test("encrypt -> decrypt round-trips the plaintext", () => {
  const plaintext = "Hej, din klient har CPR 010203-1234.";
  const env = encrypt(plaintext);
  assert.equal(decrypt(env), plaintext);
});

test("ciphertext does not contain the plaintext", () => {
  const plaintext = "hemmelig besked";
  const env = encrypt(plaintext);
  const raw = Buffer.from(env.ciphertext, "base64").toString("latin1");
  assert.ok(!raw.includes(plaintext));
});

test("each encryption uses a fresh IV (no nonce reuse)", () => {
  const a = encrypt("samme tekst");
  const b = encrypt("samme tekst");
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test("tampering with the auth tag is detected (GCM integrity)", () => {
  const env = encrypt("kan ikke pilles ved");
  const tampered = { ...env, authTag: Buffer.alloc(16, 0).toString("base64") };
  assert.throws(() => decrypt(tampered));
});
