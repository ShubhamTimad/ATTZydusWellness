FROM node:24-alpine AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:1.30-alpine

# Must match backend BACKEND_PORT in the compose file (9005 by default).
ARG BACKEND_UPSTREAM_PORT=9005

RUN apk upgrade --no-cache && apk add --no-cache curl

COPY frontend/nginx.conf /tmp/default.conf
COPY frontend/nginx-map.conf /etc/nginx/conf.d/00-map.conf
RUN sed "s/__BACKEND_PORT__/${BACKEND_UPSTREAM_PORT}/" /tmp/default.conf > /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=20s --timeout=5s --retries=10 \
    CMD curl -fsS http://127.0.0.1/ > /dev/null || exit 1
