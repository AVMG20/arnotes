FROM oven/bun:1.3.10-alpine AS dependencies

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM dependencies AS database

COPY drizzle.config.ts ./
COPY server/db/schema.ts ./server/db/schema.ts

CMD ["bun", "run", "db:push"]

FROM dependencies AS builder

COPY . .
RUN bun run build

# ---

FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/data && chown -R bun:bun /app

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

USER bun

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
CMD ["bun", ".output/server/index.mjs"]
