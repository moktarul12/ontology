# Production image for the ontology / wikigraph Vite app.
# Serves `vite preview` so the AI middleware (/api/ai/*) stays available.
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN mkdir -p /app/.cache/ai

# Build static assets; preview still loads vite-plugin-ai-timeline
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=4173
ENV CACHE_DIR=/app/.cache/ai
EXPOSE 4173

# Load .env from compose env_file; preview binds all interfaces
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
