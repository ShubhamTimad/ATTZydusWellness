FROM node:20-alpine AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:1.27-alpine

# Must match backend BACKEND_PORT in the compose file (8000 local, 9005 server).
ARG BACKEND_UPSTREAM_PORT=9005
COPY frontend/nginx.conf /tmp/default.conf
RUN sed "s/__BACKEND_PORT__/${BACKEND_UPSTREAM_PORT}/" /tmp/default.conf > /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
