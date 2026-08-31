import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/classify.js";

test("plain text is not sensitive", () => {
  const r = classify("Vi ses til frokost kl 12 i kantinen.");
  assert.equal(r.sensitive, false);
  assert.equal(r.recommendedAction, "send-plain");
  assert.deepEqual(r.findings, []);
});

test("a CPR number makes the message sensitive", () => {
  const r = classify("Klientens CPR er 010203-1234, husk det.");
  assert.equal(r.sensitive, true);
  assert.equal(r.recommendedAction, "encrypt");
  const cpr = r.findings.find((f) => f.category === "cpr");
  assert.ok(cpr, "expected a cpr finding");
  assert.equal(cpr.count, 1);
});

test("an implausible date is not treated as a CPR number", () => {
  // 99/99 is not a valid birth date, so it must not trip the CPR rule.
  const r = classify("ordrenr 999999-1234");
  assert.equal(
    r.findings.some((f) => f.category === "cpr"),
    false,
  );
});

test("a lone email is not enough to force encryption", () => {
  // email weight (0.4) is below the 0.8 threshold on its own.
  const r = classify("Skriv til mig paa jarl@example.com");
  assert.equal(r.sensitive, false);
  assert.ok(r.findings.some((f) => f.category === "email"));
});

test("sensitive samples are masked, never echoed in full", () => {
  const r = classify("CPR 010203-1234");
  const cpr = r.findings.find((f) => f.category === "cpr");
  assert.ok(cpr.samples.every((s) => !s.includes("010203-1234")));
  assert.ok(cpr.samples.every((s) => s.includes("*")));
});
