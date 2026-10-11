# CreditSea Loan Management

CreditSea is a borrower and operations portal for the full personal-loan lifecycle. The web app is built with Next.js App Router, TypeScript, and Tailwind CSS; the API is Express and TypeScript; MongoDB/Mongoose stores accounts, applications, disbursements, and payments.

## Workspaces

- **Web:** `artifacts/creditsea-lms` — borrower portal and role-based operations workspace.
- **API:** `artifacts/api-server` — authenticated REST API mounted at `/api`.
- **API contract:** `lib/api-spec/openapi.yaml` — source contract for generated TypeScript client hooks and request schemas.

The web app calls the API on the same origin. The artifact preview runs the Next.js development server; production uses Next.js static export output in `artifacts/creditsea-lms/out`.

## Borrower flow

Borrowers can create an account, complete an employment and identity profile, run an eligibility check, upload a salary slip, submit a loan application, track its status, and download their own uploaded document. PAN is encrypted at rest and shown only in masked form.

Eligibility requires:

- Age from 23 through 50, inclusive.
- Monthly income of at least ₹25,000.
- Current employment.
- A valid Indian PAN format.

Loans are ₹50,000–₹500,000 for 30–365 days. Repayment is calculated using 12% annual simple interest, rounded to the nearest paise. All monetary amounts are stored as integer paise.

## Operations roles

| Role | Workspace access |
| --- | --- |
| `ADMIN` | Dashboard and every operations queue |
| `SALES` | New application and lead review |
| `SANCTION` | Approve or reject eligible applications |
| `DISBURSEMENT` | Confirm an approved loan's disbursement |
| `COLLECTION` | Review balances and record payments |
| `BORROWER` | Own profile, applications, and salary-slip downloads |

The API enforces these permissions independently of the client UI. Staff decisions and payment records retain the acting user and timestamp. Payment UTRs are normalized and unique; a payment cannot exceed the outstanding balance.

## Security and uploads

- Passwords use bcrypt; sessions use signed, HttpOnly, SameSite cookies.
- Cookie-authenticated writes require a same-origin request.
- PAN is encrypted with AES-256-GCM using a key derived from `SESSION_SECRET`.
- Salary slips are limited to 5 MB and checked against their declared PDF/JPEG/PNG type and file signature.
- Salary slips are stored in private object storage and streamed only after authorization.
- API input is validated with generated Zod schemas; sign-in and sign-up are rate limited.

Keep `MONGODB_URI`, `SESSION_SECRET`, `SEED_PASSWORD`, and object-storage configuration in Replit Secrets or another secrets manager. Never commit actual values. Changing `SESSION_SECRET` invalidates active sessions and prevents decrypting previously stored PAN values; plan key rotation before changing it.

## Configuration

See [`.env.example`](.env.example) for local variable names and placeholders.

Required at runtime:

- `MONGODB_URI` — MongoDB connection string. Use a replica set or MongoDB Atlas because payment posting uses a MongoDB transaction.
- `SESSION_SECRET` — long, random secret used for sessions and PAN encryption.
- `PRIVATE_OBJECT_DIR` and the Replit-managed object-storage configuration — private salary-slip storage.

`WEB_ORIGIN` is optional for deployments where the web app and API use different origins. For the Replit artifact setup, the API is routed at `/api` on the web app's origin.

## Run and verify

Use the configured Replit workflows:

- API: `pnpm --filter @workspace/api-server run dev`
- Web: `pnpm --filter @workspace/creditsea-lms run dev`

Useful checks:

```sh
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/creditsea-lms run typecheck
pnpm --filter @workspace/creditsea-lms run build
pnpm --filter @workspace/api-spec run codegen
```

The API unit suite covers eligibility boundaries, loan math, payment and UTR validation, lifecycle transitions, role authorization, same-origin protections, and salary-slip validation.

## Evaluation accounts

The seed command creates these accounts only when they are missing. It does not overwrite an existing account or password. All seeded accounts use the value supplied through the secure `SEED_PASSWORD` variable; the application has no public default password.

| Role | Evaluation email |
| --- | --- |
| Admin | `admin@creditsea.test` |
| Sales | `sales@creditsea.test` |
| Sanction | `sanction@creditsea.test` |
| Disbursement | `disbursement@creditsea.test` |
| Collections | `collection@creditsea.test` |
| Borrower | `borrower@creditsea.test` |

Run `pnpm --filter @workspace/api-server run seed` after setting `SEED_PASSWORD`. For a production environment, explicitly run the seed command with `ALLOW_DEMO_SEED=true`; demo accounts are not created automatically at server startup. Borrowers can also self-register through the app.

## Deployment notes

- Build and serve the web artifact using its managed artifact workflow; it uses Next.js static export.
- Run the API artifact as a Node.js service and provide the MongoDB, session, and private storage environment variables.
- Use a MongoDB replica set and a private object-storage bucket in production.
- Seed evaluation accounts only when they are needed, and use a unique password stored as a secret.
- Configure the production web origin in `WEB_ORIGIN` if the web app and API are hosted on different origins.
