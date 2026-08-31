// Server instance for the classifier service.
// This service is responsible for classifying messages as sensitive or not, and returning the classification result to the message service.
import express from "express";
import { classify } from "./classify.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/classify", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const result = classify(text);
  // Log the DECISION and category counts, never the raw content.
  console.info(
    {
      sensitive: result.sensitive,
      confidence: result.confidence,
      categories: result.findings.map((f) => f.category),
    },
    "classified message",
  );
  res.json(result);
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.info({ port }, "classifier listening"));
