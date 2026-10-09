FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend \
    BACKEND_PORT=9005

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home app

COPY requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY backend ./backend
COPY create_superuser.py ./create_superuser.py
COPY scripts/ensure_bootstrap_superuser.py scripts/ensure_system_email_templates.py ./scripts/

RUN mkdir -p /app/backend/uploads && chmod +x /app/backend/docker-entrypoint.sh

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 9005

HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=10 \
    CMD curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" > /dev/null || exit 1

CMD ["/app/backend/docker-entrypoint.sh"]
