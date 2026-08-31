// Server instance for the message service.
// At the moment I will just implement a single POST endpoint that accepts a message, classifies it, and encrypts it if necessary.
import express from "express";
import { encrypt } from "./crypto.js";
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
