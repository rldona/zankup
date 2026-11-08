# Common tasks. Everything also works with the underlying commands (see README).
.PHONY: help setup dev api db stop test lint format check generate-api

help: ## List the tasks
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-13s %s\n", $$1, $$2}'

setup: ## Install everything and create .env from .env.example
	@test -f .env || (cp .env.example .env && echo "Created .env: fill in GARMIN_PERSONAL_API_KEY")
	@command -v pnpm >/dev/null || corepack enable --install-directory "$$HOME/.local/bin" pnpm
	uv sync
	pnpm install
	mkdir -p data

dev: db api ## Start Postgres and the API in Docker, then the web app on http://localhost:5173
	pnpm dev

api: ## Start Postgres and the API (http://localhost:8000/api/health) in the background
	docker compose up -d --build --wait api

db: ## Start Postgres in the background
	docker compose up -d --wait db

stop: ## Stop the containers (the database volume is kept)
	docker compose down

test: ## Run every test
	uv run pytest
	pnpm test

lint: ## Lint and type check everything
	uv run ruff check
	uv run ruff format --check
	uv run mypy
	pnpm lint
	pnpm typecheck
	pnpm format:check

format: ## Format everything
	uv run ruff format
	uv run ruff check --fix
	pnpm -r format

check: lint test ## What CI runs (without the Docker build)

generate-api: ## Regenerate the OpenAPI document and the TypeScript API types
	pnpm generate:api
