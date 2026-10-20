# Kanobi

Kanobi is a backend-as-a-service generator. You describe your data and Kanobi writes, builds and deploys a serverless REST API for it on AWS:

1. Create a **project**.
2. Define **models** with their properties, choose which CRUD endpoints to generate, and link models with relations.
3. Click **Deploy**. Kanobi generates a TypeScript [Serverless Framework](https://www.serverless.com/) service for the project and deploys it to AWS: Lambda, API Gateway, and one DynamoDB table per model. The UI then shows the build log and live Swagger docs for the new API.

> [!WARNING]
> Kanobi is not production-ready. The API has **no authentication**, the login screen is a hard-coded client-side check (`admin` / `password`), and several injection risks are known. Read [TODO.md](TODO.md) before exposing it anywhere.

## How it works

```
┌──────────────┐  HTTP  ┌──────────────────────┐ codegen ┌──────────────────────────┐
│ Frontend UI  ├───────►│ Control-plane API    ├────────►│ S3: <projectId>/         │
│ React + Vite │        │ Lambda, DynamoDB, S3 │         │ serverless.yml, index.ts │
└──────────────┘        └──────────┬───────────┘         └────────────┬─────────────┘
                                   │ deploy                           │ zipped source
                                   ▼                                  │
                        ┌──────────────────────┐                      │
                        │ CodeBuild: build,    │◄─────────────────────┘
                        │ swagger, sls deploy  │
                        └──────────┬───────────┘
                                   ▼
                        ┌──────────────────────┐
                        │ Generated service:   │
                        │ API Gateway, Lambda, │
                        │ DynamoDB per model   │
                        └──────────────────────┘
```

- **Projects, models and deployments** are stored in a single DynamoDB table.
- **Creating a project** copies a template ([backend-service/boilerplate](backend-service/boilerplate)) to `<projectId>/` in S3.
- **Each model change** rewrites the project's `src/index.ts` with [ts-morph](https://ts-morph.com/), cloning generic handlers (`Get`, `Post`, …) as `GetProduct`, `PostProduct` and so on. It also adds or removes the matching functions and tables in the project's `serverless.yml`.
- **A deployment** zips the project from S3 and runs a CodeBuild job that builds the service, generates Swagger docs and runs `sls deploy`. The UI polls the build status and logs.

[CLAUDE.md](CLAUDE.md) has the detailed architecture notes.

## Repository layout

| Path | What it is |
|---|---|
| [backend-service/](backend-service) | Control-plane API: Serverless Framework, AWS Lambda, TypeScript, DynamoDB, S3 |
| [backend-service/boilerplate/](backend-service/boilerplate) | Template every generated service starts from (read from S3 at runtime) |
| [frontend-service/](frontend-service) | Management UI: React 19, Vite, React Router v7, Tailwind v4 |
| [frontend-service/src/e2e/](frontend-service/src/e2e) | Playwright end-to-end flows |
| [docker-compose.yml](docker-compose.yml) | Local environment: LocalStack, API and UI |
| [localstack/init/](localstack/init) | Seeds LocalStack with the table, bucket and boilerplate |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | CI: typecheck, build, unit tests with coverage, e2e |

The two packages are independent. Each has its own `package.json`, and there is no root `package.json`.

## Quick start (Docker, no AWS account)

Docker Compose runs the whole system locally. [LocalStack](https://www.localstack.cloud/) stands in for AWS, and deployments really build and deploy the generated service, to LocalStack instead of AWS.

**You need:** Docker with Compose v2. On Windows that means Docker Desktop with WSL 2 (`wsl --install`).

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| UI | http://localhost:5173 (log in with `admin` / `password`) |
| API | http://localhost:3000 |
| LocalStack | http://localhost:4566 |

On every start, LocalStack runs [`seed.sh`](localstack/init/seed.sh). It creates the `KanobiTable` table and the `kanobi-local` bucket and uploads the boilerplate. The backend and frontend reload when you edit `src/`.

**Try it:**
1. Create a project, open it, and add a model (e.g. `Product`) with a few properties.
2. Click **Deploy changes**. The first deploy takes about 2 minutes, because it runs `npm install` for the generated service and needs internet access. The page shows the build log until the status reads `SUCCEEDED`.
3. Use the Swagger panel, or call the generated API directly. Its base URL looks like `https://<id>.execute-api.localhost.localstack.cloud:4566/prod`.

```bash
curl -X POST "$BASE_URL/Product" -d '{"title":"Lamp","price":25}'
curl "$BASE_URL/Product"
```

**How local mode differs from AWS.** With `DEPLOY_TARGET=localstack` (set by the compose file):
- A local build runner replaces CodeBuild and deploys with `serverless@3` and `serverless-localstack`.
- Infrastructure calls go to LocalStack.
- Project cost always reports 0, because LocalStack has no Cost Explorer.

**LocalStack image.** Images from 2026.03 onwards need a (free) `LOCALSTACK_AUTH_TOKEN`. The compose file pins `localstack/localstack:4.14`, which runs without one. To use a newer image, copy [.env.example](.env.example) to `.env` and set `LOCALSTACK_IMAGE` and `LOCALSTACK_AUTH_TOKEN`.

Stop everything with `docker compose down -v`.

## Running the packages directly

Use Node 22.

**Backend** (`cd backend-service`):

```bash
npm ci
cp .env.example .env        # then fill it in
npm run start:local         # build + local HTTP server on :3000 (no Serverless login needed)
npm start                   # build + `sls offline` (Serverless v4, needs a Serverless login)
```

[backend-service/.env.example](backend-service/.env.example) documents every variable. With `NODE_ENV=dev`, DynamoDB and S3 use the local endpoints and events run in-process. Add `DEPLOY_TARGET=localstack` and `AWS_ENDPOINT` to deploy to LocalStack as well.

**Frontend** (`cd frontend-service`):

```bash
npm ci                      # .npmrc sets legacy-peer-deps (swagger-ui-react peer range)
npm run dev                 # http://localhost:5173
npm run build
```

The API base URL comes from `VITE_API_URL`:
- `.env.development` uses `http://localhost:3000`.
- `.env.production` uses the staging endpoint.
- Any environment variable overrides both.

## Testing

| Command | Where | What |
|---|---|---|
| `npm test` | both packages | Vitest unit tests |
| `npm run test:coverage` | both packages | Unit tests with a **100%** line, branch, function and statement threshold |
| `npm run typecheck` | backend | Type-checks source and tests |
| `npm run lint` | frontend | ESLint |
| `npm run test:e2e` | frontend | Playwright flows against the full Docker stack |

**Unit tests.**
- Backend tests live in `backend-service/test/` and mirror `src/`. AWS clients are mocked with `aws-sdk-client-mock`.
- Frontend tests sit next to their components as `*.test.tsx` (Testing Library and jsdom).

**End-to-end tests.**
- **Where they live:** `frontend-service/src/e2e/`, mirroring the page or component they exercise (`src/components/ProjectCard.tsx` → `src/e2e/components/ProjectCard.e2e.tsx`).
- **What they cover:** login, the project dashboard, editing and deleting projects, the model editor, and a full deploy that calls the generated API.
- **Stack lifecycle:** Playwright starts the stack with `docker compose up --build --wait` when it isn't already running, and stops it afterwards. Set `E2E_KEEP_STACK=1` to keep it running.
- **First run:** run `npx playwright install chromium` once before the first run.

```bash
cd frontend-service
npm run test:e2e            # headless run (~2-3 min, including a real deploy)
npm run test:e2e:ui         # interactive UI mode
npm run test:e2e:report     # open the last HTML report
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on Node 22.

| Job | When | Steps |
|---|---|---|
| Backend | every PR, push to `main`, manual | `typecheck` → `build` → `test:coverage` |
| Frontend | every PR, push to `main`, manual | `lint` (non-blocking for now) → `build` → `test:coverage` |
| E2E | push to `main` and manual runs only | Playwright against the Docker stack |
| Workflow scripts | every PR, push to `main`, manual | `node --test` for `.github/scripts/` (100% coverage) |

E2E is slow, so it doesn't run automatically on PRs. To run it for a branch, use **Actions → CI → Run workflow**, or:

```bash
gh workflow run CI --ref <branch>
```

Coverage reports, the frontend build and the Playwright report (with traces and videos of failed tests) are attached to each run as artifacts. Download them from the run's summary page, or with `gh run download <run-id> -n playwright-report`.

### Wiki update issues

The [wiki](https://github.com/NdubuisiJr/Kanobi/wiki) documents the code, so it has to follow code changes. When a PR is merged into `main`, [`.github/workflows/wiki-update-issues.yml`](.github/workflows/wiki-update-issues.yml) checks what it changed. If the change is significant, it opens an issue labelled `documentation` that lists the wiki pages to review, the files behind each one, and a checklist.

A change counts as significant when it:
- touches a **key file**: `serverless.yml`, DTOs and naming rules, codegen or the boilerplate, Docker or env setup, test infrastructure or workflows, or the frontend routes
- adds, removes or renames source files
- changes at least **50 lines** in documented code (`WIKI_MIN_CHANGED_LINES`)

Tests, lockfiles and Markdown don't count.

[`.github/scripts/wiki-impact.js`](.github/scripts/wiki-impact.js) holds the rules: which paths map to which pages, and which files are key. To skip the check, add the `skip-wiki` label or write `[skip wiki]` in the PR description. To preview the issue for any PR without opening it, run the workflow by hand:

```bash
gh workflow run "Wiki update issues" -f pr_number=<n> -f dry_run=true
```

## Deploying to AWS

The control plane deploys with the Serverless Framework (v4, which needs a Serverless account login) to `eu-west-1`, using the AWS profile `ndubuisi-profile` (see [backend-service/serverless.yml](backend-service/serverless.yml)):

```bash
cd backend-service
npm run build
npx sls deploy -s <stage>
```

**Prerequisites.**
- An S3 bucket (`BUCKET_NAME`) with the template uploaded under `boilerplate/`. Changes to `backend-service/boilerplate/` only take effect after you upload them again:
  ```bash
  aws s3 sync backend-service/boilerplate "s3://$BUCKET_NAME/boilerplate/" --exclude ".env*"
  ```
- A CodeBuild project named `sls-code-deploy`. Generated services are deployed through it.
- The variables from `backend-service/.env.example`, in a `.env` file. Today these include static AWS keys. [TODO.md](TODO.md) tracks replacing them with IAM roles.

**Frontend.** `npm run build` produces a static site in `frontend-service/dist/`, pointed at the URL in `.env.production`.

## Contributing

- **Branches and PRs:** work on a feature branch and open a pull request. Nothing is pushed to `main` directly.
- **Tests:** every change ships with tests, and coverage must stay at 100% in both packages.
- **New features:** user-facing features also need a Playwright flow, and `npm run test:e2e` must pass.
- **Bugs:** a bug fix starts with a test that reproduces it.

[CLAUDE.md](CLAUDE.md) has the full testing and Git rules, and [TODO.md](TODO.md) lists known bugs and security issues.
