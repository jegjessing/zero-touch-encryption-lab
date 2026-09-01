# Learning the setup

---

## 1. The request lifecycle (follow one message end-to-end)

1. `curl localhost:8080/messages` hits your **host** port 8080.
2. `kind` forwarded host:8080 → the cluster node's port **30080** (see
   `kind-config.yaml` `extraPortMappings`).
3. Node port 30080 belongs to the `message-api` **Service** (`type: NodePort`).
   kube-proxy load-balances it across the healthy `message-api` **Pods**.
4. `message-api` does a server-to-server REST call to
   `http://classifier:8081/classify`. That hostname is pure **cluster DNS** — the
   `classifier` Service resolves to a stable virtual IP, which fans out to the
   classifier Pods.
5. Classifier returns `{ sensitive, confidence, findings, recommendedAction }`.
6. If `sensitive`, `message-api` **AES-256-GCM encrypts** the body using a key
   from a **Secret**, then `INSERT`s into Postgres (reached via the `postgres`
   Service DNS name). If not sensitive, it stores plaintext.
7. `GET /messages/:id` reverses it: read the row, decrypt if needed, return.

The whole point: **no hop uses an IP address or a port that is hard-coded**. Every
service talks to another service by its _name_, and Kubernetes resolves it. Kill
a Pod, add a Pod, reschedule to another node — the name still works.

---

## 2. Services: three, doing three different jobs

| Service       | Type      | Reached as                     | Why this type                                |
| ------------- | --------- | ------------------------------ | -------------------------------------------- |
| `postgres`    | ClusterIP | `postgres:5432` (in-cluster)   | DB must never be exposed outside the cluster |
| `classifier`  | ClusterIP | `classifier:8081` (in-cluster) | Internal dependency of message-api only      |
| `message-api` | NodePort  | `localhost:8080` (from host)   | The one thing we deliberately expose         |

Two non-obvious details:

- **Service port ≠ container port.** The classifier listens on `8080` inside the
  Pod, but its Service publishes `8081` (`port: 8081 → targetPort: 8080`). So
  callers use `classifier:8081`. This decoupling is normal and worth internalising
  — the port a _client_ dials is a Service-level contract, independent of what the
  process happens to bind.
- **NodePort → the mapping chain.** `message-api` Service asks for
  `nodePort: 30080`. On a real cluster you'd almost always put an **Ingress** or a
  cloud LoadBalancer in front instead (see §9). NodePort + `kind`'s
  `extraPortMappings` is the simplest thing that gives you a working
  `curl localhost:8080` with zero extra components.

DNS names here are short (`postgres`, `classifier`) because everything lives in
the **same namespace** (`zerotouch-lab`). The fully-qualified form is
`classifier.zerotouch-lab.svc.cluster.local` — cross-namespace calls need at least
`classifier.zerotouch-lab`.

---

## 3. Config vs Secrets, and how they reach the process

`message-api` gets its configuration from two objects:

- **ConfigMap** `message-api-config` — the non-secret knobs (`PGHOST`, `PGPORT`,
  `PGDATABASE`, `PGUSER`, `CLASSIFIER_URL`). Injected wholesale with `envFrom` —
  every key becomes an env var. Cheap way to hand a Pod a bag of settings.
- **Secret** `message-api-secret` — `PGPASSWORD` and `ENCRYPTION_KEY`. Injected
  one key at a time with `valueFrom.secretKeyRef`, so it's explicit which secret
  value maps to which env var.

- A stock Kubernetes Secret is **base64, not encrypted**. Anyone who can `get
secret` can decode it:
  ```bash
  kubectl -n zerotouch-lab get secret message-api-secret \
    -o jsonpath='{.data.ENCRYPTION_KEY}' | base64 -d; echo
  ```
  It's a _packaging_ boundary, not a _confidentiality_ one. Real protection comes
  from RBAC (who can read it), encryption-at-rest on etcd, and ideally pulling the
  value from an external vault. Which leads to…
- In a real deployment on Azure, `ENCRYPTION_KEY` would come from **Azure Key
  Vault** (via the CSI Secrets Store driver or workload identity), be **rotated**,
  and never live in git. Here it's a demo value committed on purpose so `make up`
  is self-contained — the manifest says exactly that in a comment.

`stringData:` (what the manifests use) lets you write the raw value and lets
Kubernetes base64-encode it for you — nicer than pre-encoding `data:` by hand.

---

## 4. Deployments, replicas, labels, and load-balancing

Each service is a **Deployment** with `replicas: 2` (except Postgres, `1`).

- The Deployment's `selector.matchLabels` **must** match the Pod template's
  `labels`. That label (`app: message-api`) is also what the Service's `selector`
  targets. Labels are the only glue — there are no direct references between a
  Service and a Deployment; they just happen to select the same Pods.
- Two replicas means the Service round-robins requests. You can watch it: hit the
  API repeatedly and look at which Pod logs each request (`make logs` shows all
  message-api Pods interleaved).
- **Postgres is `replicas: 1` with `strategy: Recreate`** — deliberately. A
  single-writer database on one ReadWriteOnce volume must _not_ have two Pods
  mounting the same disk. `Recreate` tears down the old Pod before starting the
  new one (as opposed to the default `RollingUpdate`, which would briefly run two
  and corrupt data / fail to mount). This is the standard "stateful singleton"
  pattern; real HA Postgres uses an operator, not raw Deployments.

---

## 5. Liveness vs readiness — the design choice that matters

Every service has both probes, and the split is intentional:

- **Liveness** (`/healthz`) answers "is the process wedged?" If it fails,
  Kubernetes **restarts the Pod**. So it must be cheap and must **not** depend on
  downstream services. `message-api`'s liveness deliberately does _not_ touch
  Postgres — if the DB blips, we don't want every api Pod to get killed and
  restart-loop; we want them to stay up and retry.
- **Readiness** (`/readyz`) answers "should this Pod receive traffic right now?"
  `message-api`'s readiness **does** `SELECT 1` against Postgres. If the DB is
  unreachable, the Pod is pulled out of the Service's rotation (no restart) until
  it recovers.

Getting this backwards ("liveness checks the database") is a classic outage
amplifier: a slow DB makes every Pod fail liveness, so they all restart at once,
so the DB gets hammered by reconnects. Being able to explain this cleanly is a
strong senior signal.

There's a third probe type, **startupProbe**, for slow-booting apps — not needed
here because our services start in well under a second. `message-api` instead
handles the "DB isn't up yet on first boot" case in code, with a retry loop
around the initial migration (see `services/message-api/src/server.js`).

---

## 6. Storage: PVC, StorageClass, and where the bytes actually live

Postgres claims a **PersistentVolumeClaim** (`postgres-data`, 1Gi, RWO). We never
declare a PersistentVolume — a **StorageClass** provisions one dynamically.
`kind` ships the `standard` (rancher local-path) StorageClass out of the box, so
the claim is satisfied by a directory on the node (which is itself a container).

Consequences worth knowing:

- `PGDATA` is set to a **subdirectory** (`/var/lib/postgresql/data/pgdata`) of the
  mount, not the mount root. The `postgres` image dislikes initialising a data dir
  that isn't empty (a `lost+found` on some volumes breaks it); the subdir avoids
  that. Small, common gotcha.
- The data survives Pod restarts and rollouts, but **`make down` deletes the
  cluster and the data with it** — the volume lives inside the kind node
  container. This is a lab, not a place to keep anything.

Inspect it live:

```bash
kubectl -n zerotouch-lab exec deploy/postgres -- \
  psql -U zerotouch -d zerotouch -c 'SELECT id, encrypted, created_at FROM messages;'
```

---

## 7. Requests, limits, and why they're set

Every container declares `resources.requests` (what the scheduler reserves) and a
memory `limits` (a hard ceiling — exceed it and the container is OOM-killed).
Even in a lab this is good hygiene:

- **requests** drive scheduling and, for CPU, proportional sharing under
  contention. They're a promise the node keeps.
- **memory limit** is enforced hard; **no CPU limit** here on purpose — CPU limits
  cause throttling that's usually worse than the problem, so a common convention
  is "request CPU, don't limit it; request _and_ limit memory." You can defend
  either choice, but have a reason.

---

## 8. The `kind`-specific mechanics

`kind` = "Kubernetes IN Docker". Each **node is a Docker container** running a
full kubelet + container runtime. That produces two behaviours that surprise
people coming from a cloud cluster:

- **Images must be _loaded_, not pulled.** Your locally-built `zerotouch/*:dev`
  images don't exist in any registry. `kind load docker-image` copies them into
  the node's internal image store. That's why the Deployments set
  `imagePullPolicy: IfNotPresent` — otherwise Kubernetes would try to pull `:dev`
  from Docker Hub and fail with `ErrImagePull`. (On a real cluster you'd push to
  ACR / a registry and pull normally.)
- **Getting traffic in.** No cloud LoadBalancer exists, so the node container has
  to publish a port to your host. `extraPortMappings` (host 8080 → node 30080) is
  set at _cluster-create_ time — you can't add it to a running cluster, you'd
  recreate. That mapping only reaches a service that actually listens on node port
  30080, which is why `message-api` is a NodePort pinned to `30080`.

Check the node is just a container:

```bash
docker ps --filter name=zerotouch-lab-control-plane
```

---

## 9. What's missing vs a real production setup on Azure

Being able to name the gaps is as valuable as the build itself:

- **Ingress + TLS.** Prod would run an ingress controller (nginx / Azure
  Application Gateway) terminating HTTPS, with the API behind it — not a raw
  NodePort. Try it as a next step: `kind` supports ingress-nginx with an extra
  port mapping on 80/443.
- **Real secret management.** Azure Key Vault + CSI driver or workload identity,
  key rotation, encrypted etcd. Not committed demo keys.
- **AuthN/AuthZ on the API.** Right now anyone who can reach the endpoint can post
  and read messages. Prod needs OAuth2/OIDC plus per-message authorization.
- **Migrations as a Job.** `CREATE TABLE IF NOT EXISTS` on boot is fine for a lab;
  prod runs schema migrations as an init container or a one-shot `Job`, not from
  every app Pod.

---

## 10. Guided experiments (learn by breaking things)

```bash
# Scale the classifier and watch new Pods join the Service
kubectl -n zerotouch-lab scale deploy/classifier --replicas=4
kubectl -n zerotouch-lab get pods -w

# Kill a message-api Pod; a new one is recreated to keep replicas=2
kubectl -n zerotouch-lab delete pod -l app=message-api --wait=false
kubectl -n zerotouch-lab get pods -w

# Watch a rolling update after a code change
make redeploy            # then, in another terminal:
kubectl -n zerotouch-lab rollout status deploy/message-api

# Break readiness on purpose: scale Postgres to 0 and watch message-api
# go NotReady (but NOT restart — that's the liveness/readiness split working)
kubectl -n zerotouch-lab scale deploy/postgres --replicas=0
kubectl -n zerotouch-lab get pods            # message-api READY 0/1, still Running
kubectl -n zerotouch-lab scale deploy/postgres --replicas=1   # recovers

# Prove the Secret is only base64
kubectl -n zerotouch-lab get secret message-api-secret \
  -o jsonpath='{.data.ENCRYPTION_KEY}' | base64 -d; echo

# See the ciphertext at rest
kubectl -n zerotouch-lab exec deploy/postgres -- \
  psql -U zerotouch -d zerotouch -c \
  'SELECT id, encrypted, left(coalesce(body_cipher,body_plain),30) FROM messages;'

# describe / events when something's wrong — your first debugging move
kubectl -n zerotouch-lab describe pod -l app=message-api | sed -n '/Events/,$p'
```
