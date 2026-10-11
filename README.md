# CreditSea Loan Management

CreditSea is a borrower and operations portal for the full personal-loan lifecycle. The web app is built with Next.js App Router, TypeScript, and Tailwind CSS; the API is Express and TypeScript; MongoDB/Mongoose stores accounts, applications, disbursements, and payments.

## Repository layout

```text
artifacts/
  creditsea-lms/          Next.js borrower and operations web app
  api-server/             Express API, Mongoose models, routes, tests, and seed script
lib/
  api-spec/               OpenAPI source contract
  api-zod/                Generated request and response validators
  api-client-react/       Generated React Query API client
  db/                     Shared database package
scripts/                  Workspace scripts
README.md
STARTUP.md
.env.example
```

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
| `SALES` | Overview statistics and sales lead review |
| `SANCTION` | Overview statistics and sanction decisions |
| `DISBURSEMENT` | Overview statistics and loan disbursement |
| `COLLECTION` | Overview statistics and payment collection |
| `BORROWER` | Own profile, applications, and salary-slip downloads |

The overview-statistics endpoint is available to all staff roles. Queue and action endpoints remain role-restricted. The API enforces permissions independently of the client UI. Staff decisions and payment records retain the acting user and timestamp. Payment UTRs are normalized and unique; a payment cannot exceed the outstanding balance.

## REST API

The full request and response contract is maintained in [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml). All paths below are under `/api`; protected endpoints require the session cookie.

| Area | Methods and paths | Access |
| --- | --- | --- |
| Authentication | `POST /auth/signup`, `/auth/login`, `/auth/logout`; `GET /auth/me` | Signup and login are public; `/me` requires a session |
| Borrower | `GET, PUT /borrower/profile`; `POST /borrower/eligibility`, `/borrower/salary-slip`, `/borrower/loans`; `GET /borrower/loans`, `/borrower/loans/:id`, `/borrower/loans/:id/salary-slip` | `BORROWER`; records and files are ownership-scoped |
| Sales | `GET /operations/sales/leads` | `SALES`, `ADMIN` |
| Sanction | `GET /operations/sanction/loans`; `POST /operations/sanction/loans/:id/approve`, `/reject`; `GET /operations/sanction/loans/:id/salary-slip` | `SANCTION`, `ADMIN` |
| Disbursement | `GET /operations/disbursement/loans`; `POST /operations/disbursement/loans/:id/disburse` | `DISBURSEMENT`, `ADMIN` |
| Collection | `GET /operations/collection/loans`, `/operations/collection/loans/:id/payments`; `POST /operations/collection/loans/:id/payments` | `COLLECTION`, `ADMIN` |
| Dashboard | `GET /operations/dashboard/stats` | All staff roles |
| Health | `GET /healthz` | Public liveness check |

Operations list endpoints accept validated pagination and search query parameters. The OpenAPI file defines the precise body fields, limits, and response schemas.

## Security and uploads

- Passwords use bcrypt; sessions use signed, HttpOnly, SameSite cookies.
- Cookie-authenticated writes require a same-origin request.
- PAN is encrypted with AES-256-GCM using a key derived from `SESSION_SECRET`.
- Salary slips are limited to 5 MB and checked against their declared PDF/JPEG/PNG type and file signature.
- Salary slips are stored in private object storage (AWS S3 in production, or ./local in development). MongoDB keeps a durable `objectKey`; downloads are streamed only after authorization. Do not store temporary presigned URLs in MongoDB.
- API input is validated with generated Zod schemas; sign-in and sign-up are rate limited.
- `.gitignore` and `..ignore` exclude local environment secrets and private-key files while keeping `.env.example` as a placeholder template.

Keep `MONGODB_URI`, `SESSION_SECRET`, `SEED_PASSWORD`, and object-storage configuration in . Secrets or another secrets manager. Never commit actual values. Changing `SESSION_SECRET` invalidates active sessions and prevents decrypting previously stored PAN values; plan key rotation before changing it.

## Configuration

See [`.env.example`](.env.example) for local variable names and placeholders.

Required at runtime:

- `MONGODB_URI` — MongoDB connection string. Use a replica set or MongoDB Atlas because payment posting uses a MongoDB transaction.
- `SESSION_SECRET` — long, random secret used for sessions and PAN encryption.
- Private salary-slip storage: `AWS_REGION` + `AWS_S3_BUCKET` for AWS, or `PRIVATE_OBJECT_DIR` for ./local.

`WEB_ORIGIN` is optional for deployments where the web app and API use different origins. For the . artifact setup, the API is routed at `/api` on the web app's origin.

## Run and verify

Prerequisites are Node.js 20.9 or newer and pnpm. Install workspace dependencies once:

```sh
pnpm install
```

Use the configured . workflows:

- API: `pnpm --filter @workspace/api-server run dev`
- Web: `pnpm --filter @workspace/creditsea-lms run dev`

The API production artifact builds with `pnpm --filter @workspace/api-server run build` and starts with `PORT=8080 NODE_ENV=production pnpm --filter @workspace/api-server run start`. The web production build is a static export in `artifacts/creditsea-lms/out`; serve it using the configured web artifact rather than `next start`.

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
- The web and API artifacts are configured for separate static-web and Node API services. Production routing, environment variables, file persistence, and authenticated flows still need verification after publishing.

## Submission checklist

Do not substitute preview links for verified production links.

- **GitHub repository:** Not connected in this workspace; the configured Git remote is .'s internal backup, not a GitHub repository.
- **Live application:** Not published; there is no verified production URL yet.
- **Evaluation accounts:** The six email addresses are listed above. Accounts are not yet verified as seeded; set `SEED_PASSWORD` in . Secrets and run the seed command after MongoDB connectivity is restored.
- **Critical tests:** The current API unit suite passes 25 tests, and API/web typechecks and production builds pass. Database-backed authentication, upload, loan lifecycle, and payment integration tests remain unverified.
- **Demo video:** Not recorded. A human must record and upload a 3–5 minute walkthrough after the deployed application is working.
