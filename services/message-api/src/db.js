import pg from "pg";

export const pool = new pg.Pool({
  host: process.env.PGHOST || "postgres",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "zerotouch",
  user: process.env.PGUSER || "zerotouch",
  password: process.env.PGPASSWORD || "zerotouch",
  max: 10,
  idleTimeoutMillis: 30_000,
});

// Idempotent schema bootstrap. In a mature system this would be a proper
// migration tool (e.g. node-pg-migrate); for the lab, create-if-not-exists keeps
// the pod self-sufficient on first start.
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id            BIGSERIAL PRIMARY KEY,
      recipient     TEXT NOT NULL,
      subject       TEXT NOT NULL,
      sensitive     BOOLEAN NOT NULL,
      confidence    REAL NOT NULL,
      categories    TEXT[] NOT NULL DEFAULT '{}',
      encrypted     BOOLEAN NOT NULL,
      body_plain    TEXT,
      body_cipher   TEXT,
      body_iv       TEXT,
      body_tag      TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// Simple health check to verify that the database is reachable.
// Will be used by the Kubernetes liveness probe to restart the pod if the database is unreachable.
export async function ping() {
  await pool.query("SELECT 1");
}
