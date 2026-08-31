# zero-touch-encryption-lab

A repository trying out Kubernetes and Node.js for securing messages using a simple classifier

A small, but production-shaped secure-message platform. I will build it step by step in commits, as I evolve int the learning process.. The project should be implemented in a local **Kubernetes** cluster, I will use [kind](https://kind.sigs.k8s.io/). The messages should be stored in a database, and for this, I will use **PostgresSQL**. The services are being built using Node.js and communicate via REST.

This should cover a full cloud-style, modern backend stack based on Node.js

I might look into using tools like [spec-kit](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html). I like this tool, because it is much driven the same way as a normal process would be done:

- Define the project
- Define an architecture
- Define a list of stories
- Based on the stories we define features

I want this to be done at the latest in two days, so I'm not sure how many steps I get to, seeing that I also need to work.

## Step 1

I will start, by building a POC with:

- A Node.js based service for receiving messages
- A Node.js nased service for checking if the message qualifies as to contain sensitive information

```
                 ┌───────────────┐   POST /classify    ┌──────────────┐
   client  ────► │  message-api  │ ──────────────────► │  classifier  │
                 │               │ ◄────────────────── │   stateless  │
                 └───────────────┘   {sensitive,...}   └──────────────┘
                          encrypt body if sensitive (AES-256-GCM)

```

### What is here so far

Two small Express services under `services/`, plus a `docker-compose.yml` at the root to run them together.

**message-api** (port 8088) exposes `POST /messages`. It takes `{ recipient, subject, body }`, calls the classifier to decide if the message is sensitive, and if it is, encrypts the body before it would be stored. It returns the classification and whether the body was encrypted. If the classifier is unreachable it fails with a 502 rather than sending something unclassified.

**classifier** (port 8080) is stateless and exposes `POST /classify`. It scans the text with a set of regex rules and returns _what_ was found and _what to do about it_ (`sensitive`, `confidence`, `recommendedAction`, `findings`). The idea is Zero-Touch: the platform decides, not the user. The detectors are Danish-flavoured on purpose — CPR numbers (with a light date sanity check), emails, DK phone numbers, IBAN and payment cards, each with its own weight. Matches are masked so the raw values are never echoed back or logged.

**Encryption** is AES-256-GCM (`services/message-api/src/crypto.js`), which gives confidentiality and integrity. A fresh 12-byte IV per message, 16-byte auth tag, all base64. The 32-byte key comes from `ENCRYPTION_KEY` in the environment — never in the code or git history; later this is meant to come from a Kubernetes Secret. `decrypt` is there for future read-back.

Both services have a small unit test (`test/`) covering the classifier rules and the encrypt/decrypt round-trip.

### Trying it out

`postman/Zerotouch Lab.postman_collection.json` is a Postman collection that hits `POST /messages`. It has a happy path (a plain Danish lunch message that stays plaintext, and one with a CPR number that gets encrypted) and a not-so-happy path with the 400 cases — missing body, missing recipient/subject, wrong body type, empty object, malformed JSON.

### Tooling / dev setup

- **Prettier** (`.prettierrc.json`, `.prettierignore`) and **ESLint** (`eslint.config.js`, flat config) for formatting and linting.
- **VS Code** workspace settings under `.vscode/` — format on save, eslint auto-fix, and the two recommended extensions.
- A **pre-push git hook** (`.githooks/pre-push`) that runs the format check, lint, and tests, and aborts the push on any failure so nothing broken or unformatted leaves the machine. Enable it once with `git config core.hooksPath .githooks`.

I have skipped validation and creating repsponse models etc. since this is a refresher for setting up Kubernetes and working with Node.js services

### Containers

Both services now ship with their own `Dockerfile` (`services/classifier/Dockerfile`, `services/message-api/Dockerfile`). They are deliberately boring: `node:24-alpine` for a small image, `NODE_ENV=production`, dependencies installed in their own layer _before_ the source is copied so a code change doesn't re-run `npm install`, and `USER node` so nothing runs as root inside the container. Each just `EXPOSE`s its port and starts `node src/server.js`. This is the shape I want before moving to Kubernetes — the same image runs under compose now and in a pod later, no changes.

`docker-compose.yml` at the root wires the whole thing together: `postgres:16`, the classifier, and the message-api. The api is handed everything it needs through the environment — `CLASSIFIER_URL` pointing at the classifier by service name, the dev `ENCRYPTION_KEY`, and the `PG*` connection details — and `depends_on` with `condition: service_healthy` makes it wait for the database's `pg_isready` healthcheck to pass before it starts, so there is no start-up race. Postgres data lives in a named `pgdata` volume so rows survive a `docker compose down`. The `ENCRYPTION_KEY` in there is a throwaway local key on purpose; in production it comes from a secret store, never from git.

### Persistence (Postgres)

The messages now actually get stored. `message-api` talks to a **PostgreSQL 16** instance through a small `pg` pool in `services/message-api/src/db.js`, and `docker-compose.yml` brings the database up alongside the two services (with a `pg_isready` healthcheck so the api waits until it can actually connect).

On startup the api pings the database and runs a create-if-not-exists bootstrap of a single `messages` table — no migration tool yet, just enough to keep the pod self-sufficient on first start; a real migration tool (e.g. `node-pg-migrate`) is a Step 2+ concern. Every `POST /messages` now writes a row and returns the generated `id` and `createdAt` alongside the classification. The split I care about: a **sensitive** message is stored as ciphertext only (`body_cipher`, `body_iv`, `body_tag`) and the plaintext is never written; a non-sensitive one is stored as `body_plain`. So the encrypt-at-rest promise holds all the way down to the row.

Connection details come from the environment (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) with sane local defaults — same pattern as `ENCRYPTION_KEY`, so this moves to a Kubernetes Secret later.

## Step 2

Add the PostgresSQL and the Kubernetes implementation

# If there is time

## Step 3

Implement an Ingress

## Step 4

Add some sort of AI layer to do the classification?

## Step 5

In a new branch, create a SDD version
