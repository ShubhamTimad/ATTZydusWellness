FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY backend ./backend
COPY create_superuser.py ./create_superuser.py
COPY scripts ./scripts

RUN mkdir -p /app/backend/uploads && chmod +x /app/backend/docker-entrypoint.sh

EXPOSE 9005

CMD ["/app/backend/docker-entrypoint.sh"]
