# TenderSense AI — common dev workflows. Run `make help` for the full list.
.PHONY: help install dev test test-backend test-backend-integration test-ai test-frontend bench demo smoke-bharat clean stop

PORT_AI ?= 8081
PORT_BENCH ?= 8083
N ?= 500
C ?= 50

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install all per-service dependencies (Python, Node, Go modules)
	cd ai-service && python3.12 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt
	cd frontend && npm install
	cd backend && go mod download

dev: ## Run the AI service + frontend dev server in foreground (Ctrl-C to stop). Backend + Postgres assumed via `docker compose up -d db backend ai-service`.
	@echo "Tip: run 'docker compose up -d db' first, then 'make dev' in two terminals (one for ai-service, one for frontend)."
	@echo "Use 'docker compose up' for a full local stack."

test: test-backend test-ai test-frontend ## Run every test suite

test-backend: ## go test ./...
	cd backend && go test ./...

test-backend-integration: ## go test with -tags=integration (needs TEST_DATABASE_URL)
	cd backend && go test -tags=integration ./... -count=1

test-ai: ## pytest -q (ai-service)
	cd ai-service && . .venv/bin/activate && pytest -q

test-frontend: ## vitest run (frontend)
	cd frontend && npm test

bench: ## Run the throughput benchmark in sovereign mode (default 500 req @ 50 concurrent)
	@echo "Starting ai-service in sovereign mode on port $(PORT_BENCH)..."
	@cd ai-service && . .venv/bin/activate && \
		DATA_DIR="$$(pwd)/data" ALLOWED_ORIGINS='*' \
		LLM_BACKEND=disabled TRANSLATION_BACKEND=disabled \
		nohup uvicorn main:app --host 127.0.0.1 --port $(PORT_BENCH) --log-level warning \
		> /tmp/tendersense-bench.log 2>&1 & echo $$! > /tmp/tendersense-bench.pid
	@for i in $$(seq 1 30); do \
		if curl -fsS http://127.0.0.1:$(PORT_BENCH)/health > /dev/null 2>&1; then break; fi; \
		sleep 0.5; \
	done
	@cd ai-service && . .venv/bin/activate && \
		python ../demo/benchmark.py --url http://127.0.0.1:$(PORT_BENCH) --n $(N) --concurrency $(C); \
		BENCH_RC=$$?; \
		kill $$(cat /tmp/tendersense-bench.pid) 2>/dev/null; \
		exit $$BENCH_RC

demo: ## Generate / regenerate the four deterministic demo PDFs and verify them
	cd demo && pip install -q -r requirements.txt && python generate_demo_pdfs.py && python verify_demo_pdfs.py

smoke-bharat: ## End-to-end curl smoke against the new Bharat-first endpoints (requires ai-service running on $(PORT_AI))
	./demo/smoke_bharat.sh http://127.0.0.1:$(PORT_AI)

stop: ## Stop any background ai-service started by `make bench`
	@if [ -f /tmp/tendersense-bench.pid ]; then \
		kill $$(cat /tmp/tendersense-bench.pid) 2>/dev/null || true; \
		rm -f /tmp/tendersense-bench.pid; \
		echo "Stopped background ai-service."; \
	else \
		echo "No background ai-service to stop."; \
	fi

clean: stop ## Stop background processes and clean build artifacts
	rm -rf frontend/dist frontend/node_modules/.vite
	find ai-service -type d -name __pycache__ -exec rm -rf {} +
	find ai-service -type f -name '*.pyc' -delete
