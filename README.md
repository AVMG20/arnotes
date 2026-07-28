# Arnotes

[![CI](https://github.com/AVMG20/arnotes/actions/workflows/ci.yml/badge.svg)](https://github.com/AVMG20/arnotes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-34d399.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-34d399.svg)](https://github.com/AVMG20/arnotes/releases)

Arnotes is a fast, self-hosted note-taking app organized around inline tags. It includes a rich-text editor, full-text search, attachments, expiring public links, an installable PWA, and optional AI writing tools through OpenRouter.

![Arnotes editor](public/screenshot.png)

> Arnotes is at version 0.1.0. Back up your data before upgrading and review the [changelog](CHANGELOG.md) for upgrade instructions.

## Features

- Organize notes by typing `#tags` directly in the editor
- Rich editing with headings, tables, tasks, code blocks, highlighting, and images
- Search across titles, content, and tags
- Markdown import and export
- Soft deletion and trash recovery
- Private notes with optional expiring public links
- Email/password accounts and optional Discord OAuth
- Bring-your-own-key OpenRouter integration; AI is entirely optional
- Installable Progressive Web App
- Docker-based self-hosting with persistent PostgreSQL and attachment storage

## Quick Start

Requirements: [Git](https://git-scm.com/) and Docker with the Compose plugin.

```bash
git clone https://github.com/AVMG20/arnotes.git
cd arnotes
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000), create an account, and start writing. The first account receives a welcome note automatically.

That is the entire local self-hosting setup. Compose builds Arnotes, starts PostgreSQL, waits for it to become healthy, pushes the Drizzle schema, and generates a persistent authentication secret.

Check status and logs with:

```bash
docker compose ps
docker compose logs -f app
```

Stop the stack without deleting data:

```bash
docker compose down
```

## Self-Host With Docker

The defaults are intended to work immediately on a trusted local machine. For an internet-facing server, create a `.env` file first:

```bash
cp .env.example .env
```

At minimum, change these values:

```dotenv
BETTER_AUTH_URL=https://notes.example.com
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
ALLOW_SIGN_UP=true
```

Generate an authentication secret with `openssl rand -base64 32`. The default `DATABASE_URL` connects to the bundled PostgreSQL service; replace the complete URL only when using an external PostgreSQL database.

Start the production stack:

```bash
docker compose up -d --build
```

Create your owner account, then set `ALLOW_SIGN_UP=false` in `.env` and apply the change:

```bash
docker compose up -d
```

### HTTPS And Reverse Proxy

Arnotes listens on port `3000`. Put it behind a TLS-terminating reverse proxy for internet access. `BETTER_AUTH_URL` must exactly match the public origin, including `https://` and any non-standard port.

Example Caddy configuration:

```caddyfile
notes.example.com {
  reverse_proxy localhost:3000
}
```

Only expose the application through the reverse proxy. PostgreSQL is bound to `127.0.0.1` by default and should not be made publicly reachable.

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Public application origin used by authentication |
| `APP_PORT` | `3000` | Host port mapped to the application |
| `DATABASE_URL` | bundled PostgreSQL | Complete PostgreSQL connection URL |
| `BETTER_AUTH_SECRET` | generated | Stable 32+ character authentication secret; generated into the data volume when empty |
| `ALLOW_SIGN_UP` | `true` | Whether visitors may create email/password accounts |
| `DISCORD_ENABLED` | `false` | Show and enable Discord OAuth sign-in |
| `DISCORD_CLIENT_ID` | empty | Discord application client ID |
| `DISCORD_CLIENT_SECRET` | empty | Discord application client secret |

To enable Discord, set all three Discord variables and register this redirect URL in the Discord developer portal:

```text
https://notes.example.com/api/auth/callback/discord
```

OpenRouter credentials are entered per user under Settings and are not server environment variables.

### Persistent Data

Compose creates two named volumes:

- `arnotes_postgres_data` stores accounts, notes, settings, and metadata.
- `arnotes_app_data` stores uploaded attachments and the auto-generated auth secret.

`docker compose down` keeps both volumes. `docker compose down -v` permanently deletes them.

### Backups

Back up both PostgreSQL and the application data volume:

```bash
docker compose exec -T postgres pg_dump -U arnotes -d arnotes > arnotes.sql
docker run --rm -v arnotes_app_data:/data:ro -v "$PWD":/backup alpine tar czf /backup/arnotes-data.tar.gz -C /data .
```

When using an external database, use its matching connection details instead. Store the backup files somewhere separate from the host running Arnotes.

### Updates

Pull the new source, rebuild the image, and let Compose push the current schema before starting Arnotes:

```bash
git pull --ff-only
docker compose up -d --build
docker image prune -f
```

Take a backup first. Watch startup with `docker compose logs -f app` and verify `http://localhost:3000/api/health` returns a healthy response.

## Development

Requirements:

- [Bun 1.3.10 or newer](https://bun.sh/)
- Docker with Compose

Install dependencies and prepare local configuration:

```bash
bun install
cp .env.example .env
```

For native development, change `postgres` to `localhost` in `DATABASE_URL` inside `.env`.

Start only PostgreSQL, then run Nuxt with hot reload:

```bash
docker compose up -d postgres
bun run db:push
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `bun run db:push` again after changing `server/db/schema.ts`.

Useful commands:

```bash
bun run lint          # ESLint
bun run typecheck     # Vue and TypeScript checks
bun run build         # Production build
bun run db:push       # Push server/db/schema.ts to PostgreSQL
```

Database structure is defined only in `server/db/schema.ts`. After changing it, run `bun run db:push`; do not commit generated SQL, snapshots, or migration metadata.

## Architecture

- Nuxt 4 and Vue 3 provide the client and Nitro API server.
- Nuxt UI and Tailwind CSS provide the interface.
- Better Auth handles email/password sessions and optional Discord OAuth.
- Drizzle ORM and PostgreSQL store application data.
- Uploaded files are stored under `data/attachments` and mounted as a Docker volume.
- OpenRouter powers optional user-configured AI actions.

## Marketing Site

The standalone [`index.html`](index.html) is the project marketing page. To publish it with GitHub Pages, set Pages **Source** to **Deploy from a branch**, then select the `main` branch and `/(root)` folder.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Please report security issues privately according to [SECURITY.md](SECURITY.md).

## License

Arnotes is available under the [MIT License](LICENSE).
