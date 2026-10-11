# Start CreditSea

## 1. Configure the environment

Use the existing [`.env.example`](.env.example) as the variable checklist. In Replit, store secret values in **Tools → Secrets**, not in source control or chat.

Required:

- `MONGODB_URI` — a reachable MongoDB replica set, such as an active Atlas cluster. The application uses transactions for posting payments.
- `SESSION_SECRET` — a unique, randomly generated value of at least 32 characters.
- `PRIVATE_OBJECT_DIR` and the Replit-managed App Storage configuration for private salary-slip files.

Optional:

- `WEB_ORIGIN` — only needed when the web app and API are served from different origins.
- `SEED_PASSWORD` — a unique password used only when creating the evaluation accounts.

`PORT` is supplied by the configured Replit workflows. The current authentication system uses bcrypt-hashed passwords, signed HttpOnly session cookies, and server-side role checks; Firebase is not configured or required. Borrower signup always creates a borrower account, while operations access is limited by staff role.

## 2. Start the Replit workflows

Start both existing workflows from the Replit Workflows panel:

1. **API Server** — runs `pnpm --filter @workspace/api-server run dev` and serves the API at `/api`.
2. **web** — runs `pnpm --filter @workspace/creditsea-lms run dev` and serves the CreditSea portal at `/`.

Open the web app’s Preview. The API and web app share the same origin through the configured artifact routing; do not create duplicate workflows or run a second copy on the same ports.

For a normal terminal session, install dependencies once with `pnpm install`. The two commands above are the workflow commands; they rely on the workflow-provided ports and routing.

## 3. Create evaluation accounts (optional)

After MongoDB is reachable, set `SEED_PASSWORD` in Replit Secrets, then run:

```sh
pnpm --filter @workspace/api-server run seed
```

The seed script creates missing evaluation accounts and does not overwrite existing account roles or passwords. In a production environment, explicitly set `ALLOW_DEMO_SEED=true` for that seed command. The API does not seed accounts at startup.

## 4. Run checks

```sh
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/creditsea-lms run typecheck
pnpm --filter @workspace/creditsea-lms run build
```

## Troubleshooting

If the API stops during startup with `ReplicaSetNoPrimary`, it cannot reach an active MongoDB primary. Confirm the URI points to a running replica-set cluster and that its network access rules allow this Replit environment. Update `MONGODB_URI` in Secrets, then restart the **API Server** workflow.
