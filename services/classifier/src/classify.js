// Zero-Touch classification.
//
// Zerotouch's whole pitch is that the *user* should not have to decide whether a
// mail is confidential — the platform decides automatically. This module is a
// small, honest version of that idea: scan the text for personally identifiable
// / sensitive data and return both WHAT was found and WHAT to do about it.
//
// The detectors are deliberately Danish-flavoured (CPR numbers, DK phone
// numbers) because that is exactly the market Zerotouch serves.

const CPR = /\b(\d{6})[-\s]?(\d{4})\b/g; // ddmmyy-xxxx
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DK_PHONE = /(?<!\d)(?:\+45[\s]?)?(?:\d{2}[\s]?){3}\d{2}(?!\d)/g;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

// A CPR number encodes a birth date. We do a light plausibility check on the
// first six digits so a random 10-digit string is not flagged as a CPR number.
function looksLikeCpr(dd, mm) {
  const day = Number(dd);
  const month = Number(mm);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

// Lets create some rules for detecting sensitive information.
// Each rule has a category, a label, a weight, and a find function that returns an array of matches.
// The weight is used to calculate the overall sensitivity score of the text.
// The find function uses regular expressions to find matches in the text and returns an array of masked matches.
const RULES = [
  {
    category: "cpr",
    label: "Danish CPR number",
    weight: 1.0,
    find(text) {
      const hits = [];
      for (const m of text.matchAll(CPR)) {
        const dd = m[1].slice(0, 2);
        const mm = m[1].slice(2, 4);
        if (looksLikeCpr(dd, mm)) hits.push(mask(m[0]));
      }
      return hits;
    },
  },
  {
    category: "email",
    label: "Email address",
    weight: 0.4,
    find: (text) => [...text.matchAll(EMAIL)].map((m) => mask(m[0])),
  },
  {
    category: "phone",
    label: "Phone number",
    weight: 0.3,
    find: (text) => [...text.matchAll(DK_PHONE)].map((m) => mask(m[0].trim())),
  },
  {
    category: "iban",
    label: "Bank account (IBAN)",
    weight: 0.8,
    find: (text) => [...text.matchAll(IBAN)].map((m) => mask(m[0])),
  },
  {
    category: "card",
    label: "Payment card number",
    weight: 0.9,
    find: (text) => [...text.matchAll(CARD)].map((m) => mask(m[0])),
  },
];

// Never echo the raw sensitive value back in a classification response or a log
// line — that would defeat the purpose. Keep only enough to be recognisable.
function mask(value) {
  const v = value.replace(/\s/g, "");
  if (v.length <= 4) return "*".repeat(v.length);
  return v.slice(0, 2) + "*".repeat(Math.max(0, v.length - 4)) + v.slice(-2);
}

export function classify(text = "") {
  const findings = [];
  let score = 0;

  for (const rule of RULES) {
    const matches = rule.find(text);
    if (matches.length > 0) {
      findings.push({
        category: rule.category,
        label: rule.label,
        count: matches.length,
        samples: matches.slice(0, 3),
      });
      score += rule.weight * matches.length;
    }
  }

  const sensitive = score >= 0.8; // a single CPR, IBAN or card is enough
  const confidence = Math.min(1, Number(score.toFixed(2)));

  return {
    sensitive,
    confidence,
    recommendedAction: sensitive ? "encrypt" : "send-plain",
    findings,
  };
}
