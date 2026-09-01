# Zerotouch lab — local Kubernetes with two Node.js services + Postgres.
# Run `make up` for the full path: cluster -> build -> load -> deploy -> test.

CLUSTER := zerotouch-lab
KUBECTL := kubectl --context kind-$(CLUSTER)
NS := zerotouch-lab

up: cluster build load deploy wait ## full setup from scratch

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

dashboard: ## print the Headlamp login token and the URL to open
	@echo "Open http://localhost:8090 and paste this token to log in:"
	@echo
	@$(KUBECTL) -n $(NS) create token headlamp-admin --duration=24h

test: ## run the smoke test against localhost:8080
	./scripts/smoke-test.sh
	
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
