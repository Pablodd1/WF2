# Deployment Runbook

## Current Checks

```bash
npm ci
npm run lint
npm run build
npm run test:normalization
npm run test:security
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

## Service Authentication

All server-side mutation endpoints require a shared bearer token named
`INGEST_API_TOKEN`. Generate a long random value and store it only in the
deployment secret stores.

- Set the token in Vercel for the API deployment.
- Set the same token in Railway for the WhatsApp listener or migration caller.
- Redeploy both services after changing the token.
- Never place the token in Git, client-side variables, logs, or documentation.

Release condition: verify an unauthenticated mutation request returns `401`, a
request with the configured bearer token reaches normal request validation, and
the WhatsApp listener can ingest a controlled test message. Roll back both
deployments together if the caller and API token values do not match.

