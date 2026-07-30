import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// DATABASE_URL is shared with Docker Compose, where the database is reachable as
// `postgres`. Outside the Compose network (native `bun dev`) that host does not
// resolve, so it is swapped for the published localhost port. Containers set
// IS_DOCKER to opt out. Mirrored in drizzle.config.ts, which the migration image
// loads on its own.
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || 'postgresql://arnotes:arnotes@localhost:5432/arnotes'
  if (process.env.IS_DOCKER) return url
  return url.replace('@postgres:', '@localhost:')
}

const client = postgres(getDatabaseUrl())
export const db = drizzle(client, { schema })
