# Zerotouch lab — local Kubernetes with two Node.js services + Postgres.
# Run `make up` for the full path: cluster -> build -> load -> deploy -> test.

CLUSTER := zerotouch-lab
KUBECTL := kubectl --context kind-$(CLUSTER)
NS := zerotouch-lab

up: cluster build load metrics deploy wait ingress test ## full setup from scratch (autoscaling + ingress)

cluster: ## create the kind cluster (idempotent)
	@kind get clusters | grep -qx $(CLUSTER) || kind create cluster --config kind-config.yaml

build: ## build both service images
	docker build -t zerotouch/classifier:dev  services/classifier
	docker build -t zerotouch/message-api:dev  services/message-api

load: ## load images into the kind cluster (no registry needed)
	kind load docker-image zerotouch/classifier:dev  --name $(CLUSTER)
	kind load docker-image zerotouch/message-api:dev  --name $(CLUSTER)

deploy: ## apply all manifests
	$(KUBECTL) apply -f k8s/00-namespace.yaml
	$(KUBECTL) apply -f k8s/

wait: ## wait for every deployment to become available
	$(KUBECTL) -n $(NS) rollout status deploy/postgres    --timeout=120s
	$(KUBECTL) -n $(NS) rollout status deploy/classifier  --timeout=120s
	$(KUBECTL) -n $(NS) rollout status deploy/message-api --timeout=120s
	$(KUBECTL) -n $(NS) rollout status deploy/headlamp    --timeout=120s

metrics: ## install metrics-server (HPA needs it) + patch it for kind's certs
	$(KUBECTL) apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml
	$(KUBECTL) -n kube-system patch deployment metrics-server --type=json \
	  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
	$(KUBECTL) -n kube-system rollout status deploy/metrics-server --timeout=120s

autoscale: metrics ## install metrics-server and apply the classifier HPA
	$(KUBECTL) apply -f k8s/60-classifier-hpa.yaml
	@echo "HPA applied. Watch it with 'make watch-hpa' and drive load with 'make load-test'."

load-test: ## run the k6 load Job and stream its output (watch scale-up in another shell)
	$(KUBECTL) -n $(NS) delete job k6-load --ignore-not-found
	$(KUBECTL) apply -f load/k6-load.yaml
	$(KUBECTL) -n $(NS) wait --for=condition=ready pod -l app=k6-load --timeout=60s
	$(KUBECTL) -n $(NS) logs -f job/k6-load

watch-hpa: ## live view of the HPA target and the classifier pods scaling
	$(KUBECTL) -n $(NS) get hpa classifier pods -l app=classifier -w

dashboard: ## print the Headlamp login token and the URL to open
	@echo "Open http://localhost:8090 and paste this token to log in:"
	@echo
	@$(KUBECTL) -n $(NS) create token headlamp-admin --duration=24h

test: ## run the smoke test against localhost:8080
	./scripts/smoke-test.sh

ingress: ## install ingress-nginx, generate a self-signed TLS cert, apply the Ingress
	$(KUBECTL) apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/kind/deploy.yaml
	$(KUBECTL) -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=180s
	$(KUBECTL) apply -f k8s/00-namespace.yaml
	@if $(KUBECTL) -n $(NS) get secret api-tls >/dev/null 2>&1; then \
	  echo "secret api-tls already exists"; \
	else \
	  tmp=$$(mktemp -d); \
	  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
	    -keyout $$tmp/tls.key -out $$tmp/tls.crt \
	    -subj "/CN=api.zerotouch.local/O=zerotouch" \
	    -addext "subjectAltName=DNS:api.zerotouch.local" 2>/dev/null; \
	  $(KUBECTL) -n $(NS) create secret tls api-tls --cert=$$tmp/tls.crt --key=$$tmp/tls.key; \
	  rm -rf $$tmp; echo "created self-signed secret api-tls"; \
	fi
	$(KUBECTL) apply -f k8s/50-ingress.yaml
	@echo "Ingress ready. Test with 'make ingress-test' (https://localhost:8443, Host: api.zerotouch.local)."

ingress-test: ## verify traffic reaches message-api through the Ingress over TLS
	./scripts/ingress-smoke.sh

redeploy: build load ## rebuild + restart after a code change
	$(KUBECTL) -n $(NS) rollout restart deploy/classifier deploy/message-api
	$(KUBECTL) -n $(NS) rollout status  deploy/classifier deploy/message-api

logs: ## tail message-api logs
	$(KUBECTL) -n $(NS) logs -l app=message-api -f --tail=50

status: ## show everything in the namespace
	$(KUBECTL) -n $(NS) get pods,svc,deploy

down: ## delete the whole cluster
	kind delete cluster --name $(CLUSTER)

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
