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

### Reading messages back

Now that rows are stored, `message-api` can hand them back out. Two read endpoints sit next to `POST /messages`:

- `GET /messages` lists the most recent messages (newest first, capped at 100). It returns **metadata only** — `id`, recipient, subject, `sensitive`, `confidence`, `categories`, `encrypted`, `createdAt` — and deliberately never the body, so listing can't leak content whether it was encrypted or not.
- `GET /messages/:id` reads a single message back and includes the body. This is the one place decryption happens: if the row was stored encrypted, it is decrypted on the way out (`body_cipher`/`body_iv`/`body_tag` → plaintext) using the same `ENCRYPTION_KEY`; a non-sensitive row just returns its `body_plain`. An unknown id gives a 404.

So the round trip is complete — a sensitive message goes in, is stored as ciphertext only, and comes back as readable text without the plaintext ever touching the database. Decrypting on read is a convenience for the lab; a real system would gate this behind auth and think hard about who is allowed to see a decrypted body.

The Postman collection has grown to match. Alongside the original `POST /messages` happy/not-so-happy cases it now covers the two read endpoints — listing, reading a plaintext message back, and reading a sensitive one back (which decrypts) — plus the 404s for an unknown id and an unknown route. There is also a small **Classifier (direct)** folder that hits `POST /classify` on its own (sensitive text, plain text below threshold, and missing text), handy for poking at the classifier without going through the api. The create requests save the returned `id` into collection variables so the read requests can use them.

```
                    localhost:8088
                         │
                         ▼
                 ┌───────────────┐   POST /classify    ┌──────────────┐
   client  ────► │  message-api  │ ──────────────────► │  classifier  │
                 │               │ ◄────────────────── │   stateless  │
                 └──────┬────────┘   {sensitive,...}   └──────────────┘
                        │ encrypt body if sensitive (AES-256-GCM)
                        ▼
                 ┌───────────────┐
                 │   Postgres    │  body stored as ciphertext when sensitive
                 │               │
                 └───────────────┘
```

## Step 2

The whole thing now runs on **Kubernetes** instead of docker-compose. Same three containers (classifier, message-api, Postgres), but described as manifests under `k8s/` and driven by a `Makefile` so the setup is one command. I'm using [kind](https://kind.sigs.k8s.io/) so the cluster is local and throwaway.

### One command to stand it up

`make up` runs the full path from nothing to a working cluster: create the kind cluster → build both images → load them into the cluster → apply the manifests → wait for every deployment to be available. There's no image registry involved — `kind load docker-image` pushes the locally built images straight into the node, so `imagePullPolicy: IfNotPresent` finds them without ever reaching out to a registry. Other handy targets: `make status` (pods/services/deployments in the namespace), `make down` (delete the whole cluster), and `make help` to list them.

Everything lives in its own `zerotouch-lab` namespace (`k8s/00-namespace.yaml`) so it's easy to see and easy to delete.

### The manifests

- **Postgres** (`k8s/10-postgres.yaml`) — a Deployment backed by a `PersistentVolumeClaim` so rows survive a pod restart, with `strategy: Recreate` because a single-writer DB on an RWO volume must never run two pods at once. The password comes from a `Secret`, and `pg_isready` is wired up as both the readiness and liveness probe. It's exposed to the other pods via a ClusterIP `Service` named `postgres`.
- **classifier** (`k8s/20-classifier.yaml`) — stateless, so it runs `replicas: 2` and lets the Service load-balance across them. Its `Service` listens on port 8081 and targets the container's 8080, which is why the api reaches it at `http://classifier:8081`.
- **message-api** (`k8s/30-message-api.yaml`) — `replicas: 2`, config split the Kubernetes-idiomatic way: non-secret settings (`PGHOST`, `PGDATABASE`, `CLASSIFIER_URL`, …) come from a `ConfigMap` via `envFrom`, while the `ENCRYPTION_KEY` and `PGPASSWORD` come from a `Secret`. This is the payoff of the earlier "everything through the environment" design — the same image that ran under compose runs here unchanged, only the source of the values moved. It's published with a `NodePort` (30080) so it's reachable from the host.
- **dashboard** (`k8s/40-dashboard.yaml`) — a [Headlamp](https://headlamp.dev/) UI so I can actually *see* what the cluster is doing, since I'm new to this. It's given `cluster-admin` via a ClusterRoleBinding (lab only — full access so the UI is useful out of the box) and exposed on `NodePort` 30090.

### Getting to it from the host

`kind-config.yaml` maps two NodePorts to `localhost` so there's no `kubectl port-forward` to keep alive:

- message-api `30080` → **`localhost:8080`** — so `curl localhost:8080/messages` just works. (Note: under Kubernetes the api is on port **8080**, not `8088` like it was under compose.)
- Headlamp `30090` → **`localhost:8090`** — open it in a browser and log in with the token from `make dashboard`, which mints a short-lived (24h) service-account token.

### Health probes

Both Node services now expose `/healthz` and `/readyz` (`services/*/src/server.js`), and the manifests point the liveness/readiness probes at them. The split matters:

- **Liveness** (`/healthz`) only answers "is the process up?" — it deliberately does **not** touch Postgres. If the database blips, we want Kubernetes to keep the pod and let it retry, not kill and restart it.
- **Readiness** (`/readyz`) decides whether the pod should receive traffic. The classifier has no downstream dependency, so ready == alive. The message-api's readiness actually pings Postgres and returns 503 if it can't reach it, so a pod is only sent requests once it can really serve them.

# If there is time

## Step 3

Implement an Ingress

## Step 4

Add some sort of AI layer to do the classification?

## Step 5

In a new branch, create a SDD version
