// Server instance for the message service.
// At the moment I will just implement a single POST endpoint that accepts a message, classifies it, and encrypts it if necessary.
import express from "express";
import { encrypt, decrypt } from "./crypto.js";
import { pool, migrate, ping } from "./db.js";

//I will use Express to create a simple REST API for the message service.
const app = express();
app.use(express.json({ limit: "1mb" }));

const CLASSIFIER_URL = process.env.CLASSIFIER_URL || "http://localhost:8080";

// Lets define the routes for the message service.
// The first route is a POST request to /messages, which will accept a JSON payload containing the
//    recipient, subject, and body of the message.
// The route will classify the message using the classifier service, and if the message is sensitive,
// it will encrypt the body before storing it in the database.

// ---- health probes -------------------------------------------------------
// Liveness must NOT depend on Postgres — if the DB blips we want k8s to keep the
// pod (and retry), not kill it. Readiness DOES check the DB so traffic only
// arrives when we can actually serve it.
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/readyz", async (_req, res) => {
  try {
    await ping();
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({ status: "not-ready", error: err.message });
  }
});

app.post("/messages", async (req, res) => {
  const { recipient, subject, body } = req.body || {};
  if (!recipient || !subject || typeof body !== "string") {
    return res.status(400).json({ error: "recipient, subject and body are required" });
  }

  // 1. Ask the classifier whether this is sensitive (Zero-Touch decision).
  let classification;
  try {
    const resp = await fetch(`${CLASSIFIER_URL}/classify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `${subject}\n${body}` }),
    });

    if (!resp.ok) throw new Error(`classifier responded ${resp.status}`);

    classification = await resp.json();
  } catch (err) {
    console.error({ err: err.message }, "classifier call failed");
    return res.status(502).json({ error: "classification service unavailable" });
  }

  const categories = classification.findings.map((f) => f.category);

  // 2. Encrypt at rest only if the content is sensitive.
  let stored;
  if (classification.sensitive) {
    const enc = encrypt(body);

    stored = await pool.query(
      `INSERT INTO messages (recipient, subject, sensitive, confidence, categories, encrypted, body_cipher, body_iv, body_tag)
       VALUES ($1,$2,true,$3,$4,true,$5,$6,$7) RETURNING id, created_at`,
      [
        recipient,
        subject,
        classification.confidence,
        categories,
        enc.ciphertext,
        enc.iv,
        enc.authTag,
      ],
    );

    console.info({ sensitive: true, categories }, "message encrypted", {
      iv: enc.iv,
      authTag: enc.authTag,
    });
  } else {
    stored = await pool.query(
      `INSERT INTO messages (recipient, subject, sensitive, confidence, categories, encrypted, body_plain)
       VALUES ($1,$2,false,$3,$4,false,$5) RETURNING id, created_at`,
      [recipient, subject, classification.confidence, categories, body],
    );

    console.info({ sensitive: false, categories }, "message not encrypted");
  }

  const row = stored.rows[0];
  res.status(201).json({
    id: row.id,
    createdAt: row.created_at,
    classification: {
      sensitive: classification.sensitive,
      confidence: classification.confidence,
      recommendedAction: classification.recommendedAction,
      categories,
    },
    encrypted: classification.sensitive,
  });
});

// List (metadata only, never the body
// And now this would be a good time to implement a response object that contains the message metadata.
// I will leave this out for now, but in a real application, I would want create a standard object and populate and return that.
app.get("/messages", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, recipient, subject, sensitive, confidence, categories, encrypted, created_at
     FROM messages ORDER BY id DESC LIMIT 100`,
  );
  res.json(rows);
});

// Read one back, decrypts on the way out
app.get("/messages/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM messages WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "not found" });

  const m = rows[0];
  const body = m.encrypted
    ? decrypt({ ciphertext: m.body_cipher, iv: m.body_iv, authTag: m.body_tag })
    : m.body_plain;

  res.json({
    id: m.id,
    recipient: m.recipient,
    subject: m.subject,
    sensitive: m.sensitive,
    confidence: m.confidence,
    categories: m.categories,
    encrypted: m.encrypted,
    body,
    createdAt: m.created_at,
  });
});
// ---- startup -------------------------------------------------------------
const port = Number(process.env.PORT || 8088);

async function start() {
  await ping();
  await migrate();
  app.listen(port, () =>
    console.log({ port, classifier: CLASSIFIER_URL }, "message-api listening"),
  );
}

start();
