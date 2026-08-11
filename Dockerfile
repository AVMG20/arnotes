# Debian rather than Alpine: the embedding model runs on onnxruntime-node, whose
# prebuilt native binding is linked against glibc and aborts on musl. The image is
# larger for it; running the encoder here is what keeps it out of every browser.
FROM oven/bun:1.3.10-debian AS dependencies

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# The migration stage touches no native code, so it stays on the small base.
FROM oven/bun:1.3.10-alpine AS database

WORKDIR /app

RUN bun add drizzle-kit@0.31.10 drizzle-orm@0.45.2 postgres@3.4.9

# Marks the container as being on the Compose network, so the `postgres` hostname
# in DATABASE_URL is used as-is instead of being rewritten to localhost for
# native development.
ENV IS_DOCKER=1

COPY drizzle.config.ts ./
COPY server/db/schema.ts ./server/db/schema.ts

CMD ["bunx", "drizzle-kit", "push", "--force"]

FROM dependencies AS builder

COPY . .
RUN bun run build

# ---

FROM oven/bun:1.3.10-debian

WORKDIR /app

COPY --from=builder /app/.output ./.output
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Model weights land in data/models, which is a volume, so the ~280 MB download
# happens once per deployment rather than once per restart.
RUN mkdir -p /app/data/models && chown -R bun:bun /app

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV IS_DOCKER=1
ENV EMBEDDING_CACHE_DIR=/app/data/models

EXPOSE 3000

USER bun

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
CMD ["bun", ".output/server/index.mjs"]
