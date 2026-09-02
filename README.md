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
- **dashboard** (`k8s/40-dashboard.yaml`) — a [Headlamp](https://headlamp.dev/) UI so I can actually _see_ what the cluster is doing, since I'm new to this. It's given `cluster-admin` via a ClusterRoleBinding (lab only — full access so the UI is useful out of the box) and exposed on `NodePort` 30090.

### Getting to it from the host

`kind-config.yaml` maps two NodePorts to `localhost` so there's no `kubectl port-forward` to keep alive:

- message-api `30080` → **`localhost:8080`** — so `curl localhost:8080/messages` just works. (Note: under Kubernetes the api is on port **8080**, not `8088` like it was under compose.)
- Headlamp `30090` → **`localhost:8090`** — open it in a browser and log in with the token from `make dashboard`, which mints a short-lived (24h) service-account token.

### Health probes

Both Node services now expose `/healthz` and `/readyz` (`services/*/src/server.js`), and the manifests point the liveness/readiness probes at them. The split matters:

- **Liveness** (`/healthz`) only answers "is the process up?" — it deliberately does **not** touch Postgres. If the database blips, we want Kubernetes to keep the pod and let it retry, not kill and restart it.
- **Readiness** (`/readyz`) decides whether the pod should receive traffic. The classifier has no downstream dependency, so ready == alive. The message-api's readiness actually pings Postgres and returns 503 if it can't reach it, so a pod is only sent requests once it can really serve them.

### CI

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs the whole thing on every push and pull request, in four jobs:

- **lint** — the same checks as the local pre-push hook: `prettier --check`, `eslint`, and the declared-dependency check. So formatting or lint slips are caught in CI, not just on my machine.
- **test** — the unit tests, as a matrix over both services.
- **e2e** — the interesting one. It builds both images, spins up a real **kind** cluster (using the same `kind-config.yaml`), applies all the `k8s/` manifests, waits for every deployment to roll out, and then runs `scripts/smoke-test.sh` against `localhost:8080`. That script proves the full classify → encrypt → store → decrypt round-trip and even `exec`s into Postgres to show the sensitive body really is ciphertext at rest. On failure it dumps pod state and logs for debugging. So the same `make up` path I run locally is exercised end-to-end in CI.

### CD

**publish** — only on a push to `main`, and only after the other three pass: it builds both images and pushes them to GHCR tagged with `latest` and the commit SHA.

There is no real continuous _deployment_ step — nothing rolls those images out to a live cluster, because there isn't a persistent one; this is a lab. The images in the registry are where the pipeline stops on purpose.

There is, however, a **fictitious `deploy` job left commented out** at the bottom of the workflow, so the shape of a real CD step is visible without actually running. If there were a persistent cluster it would: run after `publish` behind a protected `production` environment (required reviewers, wait timers), point `kubectl` at the cluster via a base64 `KUBE_CONFIG` secret scoped to a least-privilege deploy service account, then `kubectl set image` the deployments to the exact **commit-SHA tag** that `publish` just pushed — so the rollout is tied to a specific commit rather than a floating `latest` — and finally `rollout status` with a `rollout undo` to auto-roll-back if the new image never becomes healthy. To turn it on you'd uncomment it and add the secret; everything else is already wired.

## Step 3

The message-api now sits behind a real **Ingress** instead of only a raw NodePort, so it's reached the way a production service would be: one HTTP(S) front door, host-based routing, and TLS terminated at the edge. I'm using [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) as the controller — it's the closest local stand-in for a cloud ingress (on AKS this would be the Application Gateway Ingress Controller).

- **The controller** — `make ingress` installs ingress-nginx from the upstream kind manifest and waits for it to roll out. On kind the controller runs as a DaemonSet pinned to a node labelled `ingress-ready=true` and listens on the node's ports 80/443.
- **The Ingress** (`k8s/50-ingress.yaml`) — routes host `api.zerotouch.local` to the `message-api` Service (port 80 → container 8080), terminates TLS with the `api-tls` Secret, and forces HTTP → HTTPS with a 308 via the `nginx.ingress.kubernetes.io/ssl-redirect` annotation.
- **TLS without committing a key** — the self-signed cert and key are generated at deploy time by `make ingress` (`openssl req -x509 …`) and loaded into the cluster as the `api-tls` Secret. The private key never touches git — same discipline as `ENCRYPTION_KEY` and `PGPASSWORD`. The manifest references the Secret by name, so until it exists the Ingress is simply inert.
- **Host port mappings** — `kind-config.yaml` now maps the controller's 80/443 to **`localhost:8081`** (HTTP) and **`localhost:8443`** (HTTPS). I used 8081/8443 rather than 80/443 so it doesn't collide with anything already on the privileged ports. The old message-api NodePort → `localhost:8080` is kept alongside as the "quick" entrypoint.

### Reaching it

```
   curl -k https://localhost:8443/healthz   -H 'Host: api.zerotouch.local'   # through the Ingress, TLS
   curl     http://localhost:8081/healthz    -H 'Host: api.zerotouch.local'   # 308 redirect to HTTPS
```

Because there's no real DNS for `api.zerotouch.local`, the requests carry an explicit `Host:` header (or you can add it to `/etc/hosts`). `-k` is needed because the cert is self-signed. `make ingress-test` runs `scripts/ingress-smoke.sh`, which proves all three things end-to-end: HTTPS health works through the Ingress, plain HTTP redirects, and a full `POST /messages` round-trips over TLS.

### Autoscaling under load (HPA + k6)

The classifier is stateless and CPU-bound (regex + weighting), which makes it the natural thing to scale horizontally. Instead of pinning it at a fixed replica count, a **HorizontalPodAutoscaler** (`k8s/60-classifier-hpa.yaml`) owns the count: min 2, max 8, target **50% CPU** of each pod's request. The classifier Deployment deliberately has **no `replicas` field** — that would fight the HPA, resetting the count on every `kubectl apply`.

For the HPA to see CPU it needs **metrics-server**, which kind doesn't ship. `make metrics` installs it and patches in `--kubelet-insecure-tls` (kind's kubelet serving certs aren't signed by the cluster CA, so metrics-server otherwise refuses to scrape). It's wired into `make up`, so a fresh cluster comes up already autoscaling. Without it the HPA just sits at `TARGETS <unknown>` and never scales — the CPU **request** on the classifier (`25m`) is what the percentage is computed against, so that request is what makes autoscaling possible at all.

To actually drive it there's a **[k6](https://k6.io/) load test** (`load/classify-load.js`) that ramps to 50 virtual users and holds for 75s, hammering `POST /classify` with a sensitive Danish message so the regex path does real work. It runs as an **in-cluster Job** (`load/k6-load.yaml`, `make load-test`) that talks straight to the classifier Service over cluster DNS (`classifier.zerotouch-lab.svc.cluster.local:8081`) — so it loads the classifier directly, without going through message-api or writing rows to Postgres. `make watch-hpa` in another shell shows the scale-up live.

Running it end-to-end: CPU spiked to ~40× the target and the HPA took the classifier from **2 → 8 replicas** within about 30s, served **3.8M requests at ~38k req/s with 0 failures** (p95 ~2ms), then scaled back down to 2 once the load stopped (a 60s scale-down stabilization window, tightened from the 300s default so the lab settles quickly). The scale-up window is `0s` so it reacts fast enough to see inside a short test.

## Step 4

Add some sort of AI layer to do the classification?

## Step 5

In a new branch, create a SDD version
