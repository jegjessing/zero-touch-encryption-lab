# Kubernetes + kind cheat sheet

Dense quick-reference for the concepts this lab uses: **Node.js on Kubernetes,
kind locally, Azure/AKS as the production target, CI/CD, security/encryption.**
Command-first, with YAML skeletons and key points (▶). New to an acronym? See the
**[Glossary](#glossary)** first.

Maps to this lab: cluster `zerotouch-lab`, namespace `zerotouch-lab`,
`message-api` (NodePort) → `classifier` (ClusterIP, autoscaled) → `postgres`
(ClusterIP + PVC).

---

## Glossary

**Acronyms & terms, expanded.** If a word below is unfamiliar, its meaning here is
enough to read the rest of the doc.

| Term                             | Stands for / is                                        | One line                                                            |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| **Pod**                          | —                                                      | Smallest deployable unit: 1+ containers sharing network + storage.  |
| **Node**                         | —                                                      | A worker machine (VM/host) that runs Pods.                          |
| **Deployment**                   | —                                                      | Controller for stateless apps; rolling updates + rollback.          |
| **ReplicaSet (RS)**              | —                                                      | Keeps N identical Pods running (managed by a Deployment).           |
| **StatefulSet**                  | —                                                      | Like a Deployment but stable identity + per-Pod storage (DBs).      |
| **DaemonSet**                    | —                                                      | One Pod per node (agents, log shippers).                            |
| **Job / CronJob**                | —                                                      | Run-to-completion task / scheduled task.                            |
| **Service (svc)**                | —                                                      | Stable network endpoint fronting a set of Pods.                     |
| **ClusterIP**                    | —                                                      | Service reachable only inside the cluster (default type).           |
| **NodePort**                     | —                                                      | Service exposed on a static port on every node.                     |
| **LoadBalancer**                 | —                                                      | Service backed by an external (cloud) load balancer.                |
| **Ingress**                      | —                                                      | HTTP(S) routing + TLS termination into Services.                    |
| **Ingress controller**           | —                                                      | Component that fulfils Ingress rules (nginx, AGIC).                 |
| **ConfigMap (cm)**               | —                                                      | Non-secret config as key/value pairs.                               |
| **Secret**                       | —                                                      | Config for sensitive values — **base64, not encryption** by itself. |
| **Namespace (ns)**               | —                                                      | Virtual partition of a cluster for scope/quota/policy.              |
| **Label / Selector**             | —                                                      | Key/value tags; selectors match objects by label.                   |
| **VPA**                          | **VerticalPodAutoscaler**                              | Adjusts a Pod's requests/limits (its size).                         |
| **KEDA**                         | **K**ubernetes **E**vent-**D**riven **A**utoscaling    | Scale on queue depth / events, not just CPU.                        |
| **Cluster autoscaler**           | —                                                      | Adds/removes _nodes_ when Pods can't be scheduled.                  |
| **Probe**                        | —                                                      | Health check: liveness / readiness / startup.                       |
| **PV**                           | **PersistentVolume**                                   | A piece of cluster storage.                                         |
| **PVC**                          | **PersistentVolumeClaim**                              | A request for (and binding to) a PV.                                |
| **StorageClass (SC)**            | —                                                      | Dynamic provisioner that creates PVs on demand.                     |
| **RWO / ROX / RWX**              | ReadWriteOnce / ReadOnlyMany / ReadWriteMany           | Volume access modes.                                                |
| **QoS**                          | **Q**uality **o**f **S**ervice                         | Pod class: Guaranteed / Burstable / BestEffort.                     |
| **OOM / OOMKilled**              | **O**ut **O**f **M**emory                              | Container killed (exit 137) for exceeding its memory limit.         |
| **RBAC**                         | **R**ole-**B**ased **A**ccess **C**ontrol              | Who may do what (Roles + Bindings).                                 |
| **ServiceAccount (SA)**          | —                                                      | Identity a Pod runs as.                                             |
| **Role / ClusterRole**           | —                                                      | Permission sets — namespaced / cluster-wide.                        |
| **CRD**                          | **C**ustom **R**esource **D**efinition                 | Extends the API with new object kinds.                              |
| **Operator**                     | —                                                      | A controller + CRDs that automates a stateful app (e.g. Postgres).  |
| **Control plane**                | —                                                      | API server, scheduler, controller-manager, etcd.                    |
| **etcd**                         | —                                                      | Key/value store holding all cluster state.                          |
| **kubelet**                      | —                                                      | Node agent that runs and health-checks Pods.                        |
| **kube-proxy**                   | —                                                      | Programs node networking so Service IPs route to Pods.              |
| **CoreDNS**                      | —                                                      | In-cluster DNS; resolves Service names → ClusterIPs.                |
| **EndpointSlice**                | —                                                      | The live list of **Ready** Pod IPs behind a Service.                |
| **CNI**                          | **C**ontainer **N**etwork **I**nterface                | The pod-networking plugin.                                          |
| **CSI**                          | **C**ontainer **S**torage **I**nterface                | The storage driver plugin (e.g. Key Vault CSI).                     |
| **kubectl**                      | —                                                      | CLI that talks to the API server.                                   |
| **kind**                         | **K**ubernetes **in** **D**ocker                       | Runs clusters as Docker containers (local/CI).                      |
| **Helm / Kustomize**             | —                                                      | Templating / overlay tools for manifests.                           |
| **GitOps**                       | —                                                      | Deploy by syncing the cluster to git (Argo CD, Flux).               |
| **AKS**                          | **A**zure **K**ubernetes **S**ervice                   | Managed Kubernetes control plane on Azure.                          |
| **ACR**                          | **A**zure **C**ontainer **R**egistry                   | Azure's image registry.                                             |
| **AGIC**                         | **A**pplication **G**ateway **I**ngress **C**ontroller | Azure-native Ingress.                                               |
| **Key Vault**                    | —                                                      | Azure secret/key store; mounted via the Secrets Store CSI driver.   |
| **Workload Identity / Entra ID** | —                                                      | Azure identity for Pods / the directory service.                    |
| **GHCR**                         | **G**it**H**ub **C**ontainer **R**egistry              | Where this repo publishes images.                                   |
| **CI/CD**                        | **C**ontinuous **I**ntegration / **D**elivery          | Automated test + build + deploy.                                    |
| **TLS**                          | **T**ransport **L**ayer **S**ecurity                   | The S in HTTPS.                                                     |
| **AES-256-GCM**                  | —                                                      | Authenticated symmetric encryption used for message bodies at rest. |
| **IV**                           | **I**nitialization **V**ector                          | Per-message nonce for encryption.                                   |
| **PII**                          | **P**ersonally **I**dentifiable **I**nformation        | What the classifier looks for.                                      |
| **CPR / IBAN**                   | Danish personal ID / bank account no.                  | Example PII types the classifier detects.                           |

---

## 0. Mental model

- **Declarative, not imperative.** You describe desired state in YAML; controllers
  reconcile actual → desired continuously. `kubectl apply` submits desired state.
- **Everything is an object** in `etcd`, served by the API server. `kubectl`,
  controllers, and the scheduler all just talk to that API.
- **Labels are the only glue.** Services find Pods, Deployments own Pods, and
  selectors match Pods _by label_ — there are no hard references.
- ▶ A Deployment manages a ReplicaSet manages Pods; a Service gives that set of
  Pods one stable address; the control loop keeps reality matching the manifest.

---

## 1. kind (Kubernetes IN Docker) — local clusters

```bash
kind create cluster --name zerotouch-lab --config kind-config.yaml
kind delete cluster --name zerotouch-lab
kind get clusters
kind load docker-image zerotouch/classifier:dev --name zerotouch-lab  # push a LOCAL image in
kubectl config use-context kind-zerotouch-lab                          # context is kind-<name>
```

**Why `kind load`?** kind nodes are Docker containers with their own image store;
they can't see your host's images. `kind load` copies the image into the node so
you don't need a registry. Pair with `imagePullPolicy: IfNotPresent` so k8s uses
the loaded image instead of trying to pull.

`kind-config.yaml` — 1 node + host port mapping (how you reach a NodePort on localhost):

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: zerotouch-lab
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30080 # the Service's nodePort
        hostPort: 8080 # localhost:8080 on your machine
        protocol: TCP
```

Multi-node: add more `- role: worker` entries. Ingress on kind: label a node
`ingress-ready=true` + map 80/443.

▶ kind is throwaway, real Kubernetes — great for CI. The GitHub Actions e2e job
spins up a kind cluster and runs the smoke test on every push.

---

## 2. kubectl — the 20 commands you actually use

```bash
kubectl config get-contexts / use-context <ctx> / current-context
kubectl get pods,svc,deploy -n <ns> [-o wide]        # list; -o wide adds node/IP
kubectl get pod <p> -o yaml                          # full manifest of a live object
kubectl describe pod <p>                             # events + state — FIRST debug move
kubectl logs <p> [-c <container>] [-f] [--previous]  # -f follow; --previous = last crash
kubectl logs -l app=message-api --tail=100           # by label, across pods
kubectl exec -it <p> -- sh                           # shell into a container
kubectl apply -f k8s/                                # declarative create/update
kubectl delete -f file.yaml  |  kubectl delete pod <p>
kubectl rollout status/restart/undo deploy/<d>       # deploys
kubectl scale deploy/<d> --replicas=4
kubectl top pods / nodes                             # live CPU/mem (needs metrics-server)
kubectl get events --sort-by=.lastTimestamp         # what just happened
kubectl explain deployment.spec.strategy            # built-in schema docs
kubectl api-resources                               # every object kind + short name
kubectl port-forward svc/message-api 8080:8081      # local tunnel without NodePort
kubectl get endpointslices -l kubernetes.io/service-name=<svc>   # who's behind a Service
kubectl auth can-i get secrets                      # RBAC self-check
```

Handy: `-o jsonpath='{.status.podIP}'`, `-A` (all namespaces), `-w` (watch),
`--dry-run=client -o yaml` (generate a skeleton), `-k` (kustomize).

---

## 3. Pod / Deployment / ReplicaSet

- **Pod** = smallest unit, 1+ containers sharing network + volumes. You rarely
  create Pods directly.
- **ReplicaSet** = keeps N identical Pods alive. You rarely touch it directly.
- **Deployment** = manages ReplicaSets to give you **rolling updates + rollback**.
  This is the default for stateless services.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: classifier, namespace: zerotouch-lab }
spec:
  replicas: 2 # OMIT when an HPA owns the count (see §8)
  selector: { matchLabels: { app: classifier } }
  strategy:
    type: RollingUpdate # default; Recreate for singletons (DBs)
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } # zero-downtime shape
  template:
    metadata: { labels: { app: classifier } }
    spec:
      containers:
        - name: classifier
          image: zerotouch/classifier:dev
          imagePullPolicy: IfNotPresent
          ports: [{ containerPort: 8080 }]
```

Rollouts:

```bash
kubectl rollout status  deploy/classifier      # watch a deploy land
kubectl rollout history deploy/classifier      # revisions
kubectl rollout undo    deploy/classifier      # roll back to previous
kubectl rollout restart deploy/classifier      # re-pull/restart (e.g. after new :dev image)
```

- ▶ **RollingUpdate vs Recreate:** rolling replaces Pods gradually (zero downtime,
  briefly runs old+new); Recreate kills all old first (needed for a single-writer
  DB on a ReadWriteOnce volume — two Postgres Pods must never mount the same disk).
- **selector.matchLabels is immutable** — it must match the Pod template labels.

---

## 4. Services & networking

| Type                             | Reachable from       | Use                                   |
| -------------------------------- | -------------------- | ------------------------------------- |
| **ClusterIP** (default)          | inside cluster only  | internal deps (classifier, postgres)  |
| **NodePort**                     | `<node>:30000-32767` | expose without a cloud LB (kind demo) |
| **LoadBalancer**                 | external IP (cloud)  | prod entrypoint on AKS                |
| **Headless** (`clusterIP: None`) | pod IPs via DNS      | StatefulSets, per-pod addressing      |

```yaml
apiVersion: v1
kind: Service
metadata: { name: classifier, namespace: zerotouch-lab }
spec:
  selector: { app: classifier }
  ports:
    - port: 8081 # the address callers dial: classifier:8081
      targetPort: 8080 # the container's port
      # nodePort: 30080   # only for type: NodePort
```

**The 4 ports, don't confuse them:**
`containerPort` (what the process binds) → `targetPort` (Service forwards here) →
`port` (Service's own virtual port) → `nodePort` (host-facing, NodePort only).

**DNS & discovery:**

- CoreDNS resolves `classifier` → the Service's stable **ClusterIP**.
- Short name works same-namespace; cross-namespace use `classifier.<ns>`; FQDN is
  `classifier.zerotouch-lab.svc.cluster.local`.
- ClusterIP is a **stable virtual IP**; kube-proxy load-balances it across the
  **Ready** Pods listed in the Service's **EndpointSlice**. Pod IPs are ephemeral.
- ▶ Pods are cattle with throwaway IPs; the Service is the stable front door, and
  only Ready pods are in rotation.

**Ingress** (prod HTTP routing, TLS termination) — needs an ingress controller
(ingress-nginx, or Azure Application Gateway on AKS). This lab wires one up in
`k8s/50-ingress.yaml` (host `api.zerotouch.local` → message-api, self-signed TLS):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: message-api
  annotations: { nginx.ingress.kubernetes.io/ssl-redirect: "true" } # HTTP->HTTPS 308
spec:
  ingressClassName: nginx
  tls: [{ hosts: [api.zerotouch.local], secretName: api-tls }] # cert generated at deploy, NOT in git
  rules:
    - host: api.zerotouch.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: message-api, port: { number: 80 } } } # the SERVICE port, not the container's
```

- ▶ The `backend.port.number` is the **Service** `port` (80 here), not the
  container's `targetPort` (8080) — the Ingress talks to the Service, which
  forwards on.
- ▶ **Ingress on kind:** install the controller (`kubectl apply -f .../kind/deploy.yaml`),
  label a node `ingress-ready=true`, and map its 80/443 to the host — this lab
  uses `localhost:8081`/`:8443`. Test with an explicit `Host:` header (no DNS) and
  `-k` (self-signed): `curl -k https://localhost:8443/healthz -H 'Host: api.zerotouch.local'`.
- ▶ The label + host-port mappings are **creation-time only** in `kind-config.yaml`.
  Add them to an already-running cluster and the controller pod stays `Pending`
  (`node(s) didn't match node affinity/selector`) — recreate the cluster, don't patch it.

**NetworkPolicy** = firewall between Pods (default is "all Pods can talk"). Prod:
lock Postgres to only accept from message-api.

---

## 5. Config & Secrets

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: message-api-config, namespace: zerotouch-lab }
data: { PGHOST: postgres, PGPORT: "5432", CLASSIFIER_URL: "http://classifier:8081" }
---
apiVersion: v1
kind: Secret
metadata: { name: message-api-secret, namespace: zerotouch-lab }
type: Opaque
data: { ENCRYPTION_KEY: <base64>, PGPASSWORD: <base64> } # data = base64; stringData = plaintext
```

Inject into a Pod:

```yaml
envFrom:
  - configMapRef: { name: message-api-config } # all keys as env vars
env:
  - name: ENCRYPTION_KEY
    valueFrom: { secretKeyRef: { name: message-api-secret, key: ENCRYPTION_KEY } }
```

- ▶ **A Secret is base64, NOT encryption.** `... | base64 -d` reveals it. Real
  protection = **(1) RBAC** on who can `get secrets`, **(2) etcd encryption at
  rest** (KMS provider), **(3) an external vault** (Azure Key Vault via the
  Secrets Store CSI driver / workload identity), **(4) never commit real values**.
- Config/Secret changes: env vars need a Pod restart (`rollout restart`); mounted
  as volumes they update live (with a delay).

---

## 6. Health probes — the distinction that matters

| Probe         | Question                    | On failure                                    |
| ------------- | --------------------------- | --------------------------------------------- |
| **liveness**  | is it wedged/deadlocked?    | **kill + restart** the container              |
| **readiness** | can it serve traffic _now_? | **remove from Service rotation** (no restart) |
| **startup**   | has a slow app booted yet?  | holds off the other two until it passes       |

```yaml
livenessProbe: # cheap SELF check only
  httpGet: { path: /healthz, port: 8080 }
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe: # may check downstream deps (DB)
  httpGet: { path: /readyz, port: 8080 }
  periodSeconds: 5
```

- ▶ **Never check the DB in liveness.** A brief DB blip would fail liveness on all
  Pods → k8s restarts them all → they boot, still can't reach DB → **cluster-wide
  crash-loop**. Put the DB check in **readiness** (Pods go NotReady, pulled from
  rotation, no restart, recover when DB returns). It's _restart me_ vs _stop
  routing to me_ — not early vs late.

---

## 7. Resources, requests, limits, QoS

```yaml
resources:
  requests: { cpu: 25m, memory: 64Mi } # scheduler reserves this; HPA % is of this
  limits: { memory: 128Mi } # hard cap; mem over limit => OOMKilled
```

- **request** = guaranteed floor used for scheduling and HPA math. **limit** = ceiling.
- **CPU over limit** → throttled. **Memory over limit** → **OOMKilled** (restart).
- **QoS:** all requests==limits → _Guaranteed_; some set → _Burstable_; none →
  _BestEffort_ (first evicted under node pressure).
- `LimitRange` (per-namespace defaults) and `ResourceQuota` (namespace caps) are
  the governance layer.
- ▶ No CPU **request** means CPU-based autoscaling can't compute a percentage —
  the #1 reason an HPA sits at `<unknown>`.

---

## 8. Autoscaling — HPA (+ metrics-server)

**HPA scales replicas out/in** on a metric (CPU here). It needs **metrics-server**
running, and a **CPU request** on the pods to compute a percentage against.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: classifier, namespace: zerotouch-lab }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: classifier }
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 50 } }
  behavior:
    scaleUp: { stabilizationWindowSeconds: 0 } # react fast (demo)
    scaleDown: { stabilizationWindowSeconds: 60 } # cool down before shrinking (default 300)
```

- **The math:** `desiredReplicas = ceil( currentReplicas × currentCPU / targetCPU )`.
  CPU is a **% of the pod's `request`** — request `25m` + target `50%` ⇒ aims to
  keep each pod near `12.5m`, adding pods above that and removing below.
- **metrics-server on kind:** not shipped by default; install it and add
  `--kubelet-insecure-tls` (kind's kubelet serving cert isn't signed by the
  cluster CA, so the scrape otherwise fails). `make metrics` does both.
- **Omit `replicas`** on a Deployment an HPA owns — otherwise every `kubectl apply`
  resets the count and fights the autoscaler (§3).
- ▶ **Drive it with load, not a sleep.** This lab runs a **k6** load test as an
  in-cluster Job (`make load-test`) that hits the classifier Service directly over
  cluster DNS; `make watch-hpa` shows `2 → N` live. `kubectl top pods` needs
  metrics-server too — same dependency.
- **HPA vs VPA vs cluster autoscaler:** HPA = more pods; **VPA** = bigger pods
  (resize requests/limits); **cluster autoscaler** = more _nodes_ when pods won't
  fit. **KEDA** extends the HPA to scale on queue depth / events, not just CPU.

---

## 9. Storage & stateful workloads

- **PV** = a piece of storage; **PVC** = a claim/request for one; **StorageClass**
  = dynamic provisioner that creates PVs on demand.
- **Access modes:** RWO (one node, typical block disk — Azure Disk), ROX, RWX
  (many nodes — Azure Files/NFS).
- **Deployment vs StatefulSet:** a DB wants **stable identity + stable storage** →
  StatefulSet (stable pod names, per-Pod PVCs, ordered rollout). The lab uses a
  1-replica Deployment + `Recreate` as the deliberate "stateful singleton" shortcut.

```yaml
volumeClaimTemplates: # StatefulSet gives each Pod its own PVC
  - metadata: { name: data }
    spec: { accessModes: [ReadWriteOnce], resources: { requests: { storage: 5Gi } } }
```

- ▶ Real HA Postgres uses an operator (CloudNativePG/Zalando), not a raw
  Deployment — replication, failover, backups. The lab runs a single writer and is
  explicit about the trade-off.

---

## 10. Jobs, CronJobs, init & sidecar containers

- **Job** = run-to-completion (migrations, the k6 load test). `backoffLimit`,
  `restartPolicy: Never`.
- **CronJob** = scheduled Job (nightly cleanup, report).
- **initContainers** = run _before_ app containers (wait for DB, run schema
  migration once). App container starts only after they succeed.
- **Sidecar** = helper container in the same Pod (log shipper, proxy).
- ▶ Prod runs schema migrations as a Job/initContainer, not `CREATE TABLE IF NOT
EXISTS` on every app boot like the lab does.

---

## 11. RBAC, namespaces, ServiceAccounts

- **Namespace** = soft tenancy boundary (scope + quota + policy). The lab lives in
  `zerotouch-lab`.
- **ServiceAccount** = identity a Pod runs as (for API calls + cloud identity).
- **Role/ClusterRole** = a set of allowed verbs on resources; **RoleBinding/
  ClusterRoleBinding** grants it to a subject.

```bash
kubectl auth can-i list secrets --as=system:serviceaccount:zerotouch-lab:default
```

- ▶ RBAC is the primary boundary protecting Secrets — least privilege on who can
  `get`/`list` them.

---

## 12. Security (Pods & supply chain)

```yaml
securityContext: # pod- or container-level hardening
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
```

- Build **non-root images** (`USER node`), pin base tags (`node:24-alpine`), keep
  them slim, scan them (Trivy/Grype).
- **Pod Security Standards** (privileged / baseline / **restricted**) enforced per
  namespace replace the old PodSecurityPolicy.
- Encryption flow in this lab: **classify → decide → encrypt sensitive body at rest
  (AES-256-GCM, key from a Secret/Key Vault) → store ciphertext → authorize on
  read.**

---

## 13. Azure / AKS mapping (kind → production)

| Local (kind)            | Azure production                                                           |
| ----------------------- | -------------------------------------------------------------------------- |
| kind cluster            | **AKS** (managed control plane)                                            |
| `kind load` local image | **ACR** + `imagePullSecrets` / managed identity                            |
| NodePort + host mapping | **LoadBalancer** Service / **Application Gateway Ingress (AGIC)**          |
| Secret in git (demo)    | **Azure Key Vault** + **Secrets Store CSI driver** / **workload identity** |
| metrics-server (manual) | built in; **HPA** + **cluster autoscaler** node pools                      |
| PVC on kind's local SC  | **Azure Disk** (RWO) / **Azure Files** (RWX) StorageClass                  |
| pino JSON to stdout     | **Azure Monitor / Container Insights**, Log Analytics                      |
| `make up`               | **GitHub Actions / Azure DevOps** → `kubectl`/Helm/Kustomize deploy        |

- ▶ Kubernetes is the portable contract; AKS just supplies the managed control
  plane, identity (Entra / workload identity), registry, and storage classes. These
  manifests are already cloud-shaped.

---

## 14. CI/CD with Kubernetes

- Build image → push to registry (GHCR/ACR) tagged with the git SHA (not just
  `latest`, so deploys are pinned and rollbackable).
- **e2e in CI:** `helm/kind-action` stands up a real cluster, `kind load` images,
  `kubectl apply`, `rollout status`, run a smoke test. This repo does exactly this.
  (The HPA + k6 load test run locally via `make autoscale` / `make load-test`, not
  in CI yet.)
- Templating: **Kustomize** (overlays per env, `kubectl -k`) or **Helm** (charts +
  values). Progressive delivery: Argo CD / Flux (GitOps), blue-green / canary.

```yaml
- uses: helm/kind-action@v1
  with: { cluster_name: zerotouch-lab, config: kind-config.yaml }
```

---

## 15. Debugging playbook (symptom → cause → move)

| Symptom                           | Likely cause                                                                                        | First move                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `CrashLoopBackOff`                | app exits on boot (bad config, dep down)                                                            | `logs --previous`; `describe`                 |
| `ImagePullBackOff`/`ErrImagePull` | wrong image / not loaded / no auth                                                                  | check tag; `kind load`; imagePullSecrets      |
| `Pending`                         | no schedulable node / unbound PVC / too-big request / nodeSelector unmatched (e.g. `ingress-ready`) | `describe pod` events; check labels/quotas/SC |
| `OOMKilled` (exit 137)            | memory over limit                                                                                   | raise limit or fix leak; `kubectl top`        |
| Ready 0/1, Running                | readiness failing (dep down)                                                                        | hit `/readyz`; check the dependency           |
| Service returns nothing           | selector≠labels, or 0 Ready endpoints                                                               | `get endpointslices`; check labels            |
| HPA `TARGETS <unknown>`           | no metrics-server / no CPU request                                                                  | install metrics-server; add requests          |
| DNS fails                         | wrong name/namespace                                                                                | `exec -- getent hosts <svc>`; use FQDN        |

Universal first three moves: `kubectl describe <obj>` (read the **Events**),
`kubectl logs [--previous]`, `kubectl get events --sort-by=.lastTimestamp`.

---

## 16. 30-second architecture summary

A request hits the **message-api** Service (NodePort locally, LoadBalancer/Ingress
on AKS). It validates, calls **classifier** over cluster DNS (`classifier:8081`),
which scores the text. If sensitive, message-api encrypts the body (AES-256-GCM,
key from a Secret / Key Vault) and stores ciphertext in **Postgres** (PVC-backed).
Each service has liveness (restart-if-wedged) + readiness (route-only-when-ready)
probes; the classifier is **HPA-autoscaled** on CPU, driven locally by a k6 load
test. CI stands up a kind cluster and proves the request path end-to-end (smoke
test) on every push.
