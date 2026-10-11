# CreditSea Loan Management System

CreditSea is a full personal-loan lifecycle portal: borrowers apply online, and staff move loans through sales follow-up, sanction, disbursement, and collection.

| Layer | Stack |
| --- | --- |
| Web | Next.js App Router, TypeScript, Tailwind CSS, React Query |
| API | Express, TypeScript, Zod (from OpenAPI), Mongoose |
| Data | MongoDB (replica set required for payment transactions) |
| Storage | Private salary slips (local filesystem, AWS S3, or GCS) |

## Architecture

![CreditSea system architecture](diagram.png)

Borrower and staff UIs talk to the Express REST API on the same origin. Routes handle auth, borrower actions, sales/sanction/disbursement/collection, and employees. Shared domain and security layers validate input and enforce roles before persisting to MongoDB or private object storage.

---

## Prerequisites

- **Node.js** 20.9+ (22 recommended)
- **pnpm** 10+
- A **MongoDB replica set** (local replica set or [MongoDB Atlas](https://www.mongodb.com/atlas)) — payment recording uses MongoDB transactions

Install pnpm if needed:

```sh
npm install -g pnpm
```

---

## Quick start (local)

### 1. Clone and install

```sh
git clone <your-repo-url>
cd CreditSea-Loan-Management-System
pnpm install
```

### 2. Configure environment

```sh
cp .env.example .env
```

Edit `.env` with real values. Minimal local setup:

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/?appName=CreditSea-LMS
SESSION_SECRET=replace-with-a-unique-random-secret-at-least-32-chars
WEB_ORIGIN=http://localhost:3000
API_PROXY_TARGET=http://127.0.0.1:8080
SEED_PASSWORD=replace-with-unique-seed-password
ALLOW_DEMO_SEED=false

# Local salary-slip storage (dev)
PRIVATE_OBJECT_DIR=./.private-objects
STORAGE_DRIVER=fs
```

The API does not auto-load `.env`. Export variables before starting processes:

```sh
set -a
source .env
set +a
```

Or prefix commands with `export $(grep -v '^#' .env | xargs)` (bash/zsh).

### 3. Seed evaluation accounts

```sh
set -a && source .env && set +a
pnpm --filter @workspace/api-server run seed
```

This creates the six demo accounts **only if they do not already exist**. It never overwrites an existing password. All seed accounts share `SEED_PASSWORD` (12–128 characters).

| Role | Email |
| --- | --- |
| Admin | `admin@creditsea.test` |
| Sales | `sales@creditsea.test` |
| Sanction | `sanction@creditsea.test` |
| Disbursement | `disbursement@creditsea.test` |
| Collection | `collection@creditsea.test` |
| Borrower | `borrower@creditsea.test` |

Borrowers can also self-register at `/signup`.

### 4. Start the API

In one terminal:

```sh
set -a && source .env && set +a
export PORT=8080
pnpm --filter @workspace/api-server run dev
```

`dev` builds then starts the server. Health check: `GET http://127.0.0.1:8080/api/healthz`.

### 5. Start the web app

In a second terminal:

```sh
set -a && source .env && set +a
export PORT=3000
pnpm --filter @workspace/creditsea-lms run dev
```

Open **http://localhost:3000**.

In development, Next.js proxies `/api/*` to `API_PROXY_TARGET` (default `http://127.0.0.1:8080`), so the browser talks to one origin and cookies work without CORS friction.

---

## Environment variables

See [`.env.example`](.env.example) for the full template.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string (replica set / Atlas) |
| `SESSION_SECRET` | Yes | ≥32 chars; signs sessions and derives PAN encryption key |
| `PORT` | Yes (at runtime) | API listen port (e.g. `8080`); also used by Next `dev` |
| `WEB_ORIGIN` | Recommended | Allowed web origin(s), comma-separated, for CORS / cookie writes across hosts |
| `API_PROXY_TARGET` | Local web only | Where Next proxies `/api` in `next dev` |
| `SEED_PASSWORD` | For seeding | Password for evaluation accounts |
| `ALLOW_DEMO_SEED` | Production seed | Must be `true` to seed when `NODE_ENV=production` |
| `PRIVATE_OBJECT_DIR` + `STORAGE_DRIVER=fs` | Local storage | Filesystem backend for salary slips |
| `AWS_REGION` + `AWS_S3_BUCKET` | Production storage | Private S3 bucket for salary slips |

**Important:** Changing `SESSION_SECRET` invalidates sessions and prevents decrypting previously stored PANs. Plan key rotation carefully.

Never commit `.env`. Keep secrets in a secrets manager in production.

---

## What you can do in the product

### Borrower

1. Sign up / sign in  
2. Save profile (name, PAN, DOB, salary, employment)  
3. Check eligibility  
4. Upload salary slip (PDF / JPEG / PNG, ≤5 MB)  
5. Apply for a loan (₹50k–₹5L, 30–365 days, 12% p.a. simple interest)  
6. Open an application to see a **lifecycle timeline**, balances, and **payment history**

Eligibility rules: age 23–50, monthly income ≥ ₹25,000, employed, valid Indian PAN format.

### Operations roles

| Role | Workspace | Meaningful actions |
| --- | --- | --- |
| `ADMIN` | All queues + employees | Full access; create/disable staff |
| `SALES` | Sales leads | View unapplied borrowers; **add follow-up notes** (marks contacted) |
| `SANCTION` | Sanction queue | Approve / reject applications; download salary slip |
| `DISBURSEMENT` | Disbursement queue | Confirm bank release of sanctioned loans |
| `COLLECTION` | Collection desk | View balances; record payments (UTR + amount) |

Permissions are enforced on the API, not only in the UI.

### Suggested demo path (~10 minutes)

1. Log in as **borrower** → complete profile → eligibility → upload slip → apply  
2. Log in as **sales** → open an unapplied lead → save a note  
3. Log in as **sanction** → approve (or reject) the application  
4. Log in as **disbursement** → confirm disbursement  
5. Log in as **collection** → record a payment  
6. Log in as **borrower** again → open the loan → timeline + payments  

---

## Repository layout

```text
artifacts/
  creditsea-lms/     Next.js borrower + operations UI
  api-server/        Express API, models, routes, unit tests, seed
lib/
  api-spec/          OpenAPI source (`openapi.yaml`) + Orval codegen
  api-zod/           Generated Zod validators
  api-client-react/  Generated React Query client
  db/                Shared DB package (workspace)
scripts/             Workspace scripts
.github/workflows/   CI (typecheck, test, build)
.env.example         Env template
vercel.json          Optional static web deploy config
```

Contract-first API: edit `lib/api-spec/openapi.yaml`, then regenerate clients:

```sh
pnpm --filter @workspace/api-spec run codegen
```

---

## REST API (summary)

Full contract: [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml). Paths are under `/api`. Protected routes use the session cookie.

| Area | Methods / paths | Access |
| --- | --- | --- |
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/logout`; `GET /auth/me` | Public signup/login; `/me` authenticated |
| Borrower | Profile, eligibility, salary slip, loans; `GET …/loans/:id/payments` | `BORROWER` (ownership-scoped) |
| Sales | `GET /operations/sales/leads`; `POST /operations/sales/leads/:id/notes` | `SALES`, `ADMIN` |
| Sanction | List / approve / reject; salary-slip download | `SANCTION`, `ADMIN` |
| Disbursement | List / disburse | `DISBURSEMENT`, `ADMIN` |
| Collection | List loans; list/record payments | `COLLECTION`, `ADMIN` |
| Employees | List / create / update status | `ADMIN` |
| Dashboard | `GET /operations/dashboard/stats` | All staff roles |
| Health | `GET /healthz` | Public |

Money is stored as **integer paise**. Payment UTRs are normalized and unique; a payment cannot exceed the outstanding balance. Closing a loan happens when the outstanding balance reaches zero.

---

## Security highlights

- Passwords hashed with bcrypt; sessions are signed **HttpOnly** cookies  
- Cookie-authenticated **writes** require same-origin (CSRF-style guard); configure `WEB_ORIGIN` when web and API differ  
- **PAN** encrypted at rest with AES-256-GCM (key from `SESSION_SECRET`); UI shows masked PAN only  
- Salary slips: magic-byte type checks, size limit, private object keys in MongoDB, authorized streaming downloads only  
- Request bodies / params validated with generated Zod schemas; auth endpoints are rate limited  

---

## Scripts and CI

### Day-to-day

```sh
# API
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run build
PORT=8080 pnpm --filter @workspace/api-server run start

# Web
pnpm --filter @workspace/creditsea-lms run typecheck
NODE_ENV=production pnpm --filter @workspace/creditsea-lms run build
# Static export output: artifacts/creditsea-lms/out

# OpenAPI → Zod + React Query
pnpm --filter @workspace/api-spec run codegen

# Seed
pnpm --filter @workspace/api-server run seed
```

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push/PR to `main`/`master`:

1. Install with frozen lockfile  
2. API typecheck → unit tests → build  
3. Web typecheck → production build  

The API unit suite covers eligibility, loan math, UTR/payment rules, lifecycle transitions, RBAC, same-origin write protection, and salary-slip validation (currently **34** tests).

---

## Production notes

1. **API** — build and run as a Node service with `PORT`, `MONGODB_URI`, `SESSION_SECRET`, and a private storage backend. Use a MongoDB **replica set**.  
2. **Web** — production build is a **static export** (`artifacts/creditsea-lms/out`). Serve with any static host.  
3. **Routing** — the browser should call the API on the same origin (`/api/...`) or you must set `WEB_ORIGIN` correctly for cross-origin cookies.  
4. **`vercel.json`** — optional Vercel static deploy; update the `/api` rewrite destination to your real API host (do not leave a hardcoded demo IP in production).  
5. **Seeding in production** — only when needed: `ALLOW_DEMO_SEED=true` plus a strong `SEED_PASSWORD`. Prefer unique secrets over shared demo passwords for real deployments.

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `PORT environment variable is required` | Export `PORT` (API: `8080`, web: `3000`) |
| `MONGODB_URI is required` | Load `.env` into the shell before starting |
| `SESSION_SECRET must be configured…` | Secret must be at least 32 characters |
| Payments fail with transactions unavailable | MongoDB must be a replica set (Atlas qualifies) |
| Login works but writes fail from another host | Set `WEB_ORIGIN` to the exact web origin(s) |
| Salary slip upload/download fails | Configure `PRIVATE_OBJECT_DIR`+`STORAGE_DRIVER=fs` locally, or S3 vars in production |
| Seed does nothing for an email | Account already exists; seed never overwrites passwords |
| Web can’t reach API in `next dev` | Ensure API is on `API_PROXY_TARGET` (default `http://127.0.0.1:8080`) |

---

## License

Private / MIT as configured in the workspace `package.json`. Adjust for your distribution needs.
