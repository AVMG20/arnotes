# Contributing to Arnotes

Thanks for helping improve Arnotes.

## Before You Start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue to discuss large features or changes to persisted data first.
- Never include credentials, personal notes, database dumps, or uploaded files in a report or commit.

## Development Workflow

1. Fork and clone the repository.
2. Follow the development setup in [README.md](README.md#development).
3. Create a focused branch from `main`.
4. Update `server/db/schema.ts` and test it with `bun run db:push` when changing the database.
5. Run `bun run lint`, `bun run typecheck`, and `bun run build`.
6. Open a pull request explaining the behavior change and how it was tested.

Keep changes focused and preserve compatibility with existing persisted notes. Do not commit generated SQL, snapshots, or migration metadata.

## Bug Reports

Include the Arnotes version, browser, deployment method, relevant sanitized logs, reproduction steps, expected behavior, and actual behavior. Do not post security vulnerabilities in public issues.

## License

By contributing, you agree that your contribution is licensed under the project's MIT License.
