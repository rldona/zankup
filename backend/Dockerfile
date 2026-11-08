# Backend image for Railway (and for self-hosting with docker compose).
# Build from the repository root: docker build -f backend/Dockerfile .
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so code changes reuse this layer.
COPY pyproject.toml uv.lock .python-version ./
COPY backend/pyproject.toml backend/pyproject.toml
COPY packages/metrics/pyproject.toml packages/metrics/README.md packages/metrics/LICENSE packages/metrics/
RUN uv sync --frozen --no-dev --no-install-workspace

COPY backend backend
COPY packages/metrics packages/metrics
RUN uv sync --frozen --no-dev

# Runs as root: Railway mounts volumes owned by root, and /data holds the original FIT files.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn opensport.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
