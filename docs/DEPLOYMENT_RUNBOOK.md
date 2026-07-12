# Deployment Runbook

## Current Checks

```bash
npm ci
npm run lint
npm run build
```

Observed 2026-07-12:

- `npm ci`: passed.
- `npm run build`: passed.
- `npm run lint`: failed with existing lint errors.

## Release Rules

- No direct pushes to `main`.
- Use small PRs.
- Run checks before PR.
- Do not run production migrations from Vercel request handlers.
- Keep rollback plan for schema and API changes.
- Deploy migration tooling separately from user-facing UI.

## Required Environments

- local development
- staging
- migration runner
- production

Each must have separate credentials.

