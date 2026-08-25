FROM node:20-alpine AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Optional Sentry browser DSN (empty = disabled)
ARG VITE_SENTRY_DSN=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT=production
ENV VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
ENV VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE

RUN npm run build

FROM nginx:1.27-alpine

# Must match backend BACKEND_PORT in the compose file (9005 by default).
ARG BACKEND_UPSTREAM_PORT=9005

RUN apk add --no-cache curl

COPY frontend/nginx.conf /tmp/default.conf
RUN sed "s/__BACKEND_PORT__/${BACKEND_UPSTREAM_PORT}/" /tmp/default.conf > /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=20s --timeout=5s --retries=10 \
    CMD curl -fsS http://127.0.0.1/ > /dev/null || exit 1
