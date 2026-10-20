# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kanobi is a backend-as-a-service generator. A user creates a **project**, defines **models** (properties, which CRUD APIs to generate, relations), then triggers a **deployment**. Kanobi generates a Serverless Framework TypeScript service for that project and deploys it to AWS. The repo has two independent packages with no shared code and no root package.json:

- `backend-service/`: the Kanobi control-plane API (Serverless Framework, AWS Lambda, TypeScript, DynamoDB, S3)
- `frontend-service/`: the management UI (React 19, Vite, React Router v7 data routers, Tailwind v4)

## Commands

Backend (`cd backend-service`):
- `npm run build`: `rm -rf dist && tsc` (output goes to `dist/`, and serverless handlers point at `dist/...`)
- `npm start`: build, then run locally with `sls offline -s dev`
- Deploy: `sls deploy -s <stage>` (serverless.yml uses AWS profile `ndubuisi-profile`, region `eu-west-1`)
- `npm test` / `npm run test:coverage` / `npm run typecheck` (source + tests)

Frontend (`cd frontend-service`):
- `npm run dev` / `npm run build` (`tsc -b && vite build`) / `npm run lint` / `npm run preview`
- `npm test` / `npm run test:coverage`
- `npm run test:e2e`: Playwright flows against the Docker stack (see "E2E tests"). Also `test:e2e:ui` and `test:e2e:report`.
- Installs need `legacy-peer-deps` (set in `.npmrc`) because `swagger-ui-react` declares support only for React below 19.

## Git and GitHub (mandatory)

- **Never push without asking first.** This applies to every branch, including feature branches with an open PR. Commit locally, then stop and ask (e.g. "Push these 2 commits to `feat/x` / PR #5?"). One approval covers one push.
- **Never commit or push to `main` directly.** Changes reach `main` only through a pull request that the user reviews and merges. Before committing, check the current branch (`git branch --show-current`). If it is `main`, create a feature branch first.
- **Ask before any other action that changes GitHub:**
  - creating or editing a PR (title, description, base branch, labels)
  - merging, closing or re-targeting a PR
  - triggering, re-running or cancelling a workflow run
  - creating or deleting remote branches, tags or releases
- **No approval needed for read-only actions:** viewing PRs, checks, run logs and artifacts.
- **Stacked PRs:** when the base PR merges first, the stacked PR is not re-targeted to `main` automatically if it is merged after that. Check the base branch before asking to merge it.
- **If something was pushed or changed on GitHub without approval, say so immediately and plainly.** Include the commit or run and the branch, then ask how to fix it. Don't rewrite pushed history or force-push to clean it up.

## Local environment (Docker)

`docker compose up --build` from the repo root starts:
- **localstack (:4566):** S3, DynamoDB, CloudFormation, Lambda, API Gateway, and others. `localstack/init/seed.sh` creates `KanobiTable` and the `kanobi-local` bucket and syncs `backend-service/boilerplate/` to `s3://kanobi-local/boilerplate/` on every start.
- **backend (:3000):** `src/local/devServer.ts`, a small HTTP server that maps the `http` events in `serverless.yml` to the compiled handlers. It doesn't use `sls offline`, because Serverless v4 needs a login. It runs with `NODE_ENV=dev` and `DEPLOY_TARGET=localstack`, and `src/` is live-reloaded.
- **cognito (:9229):** [cognito-local](https://github.com/jagregory/cognito-local), the local stand-in for the Cognito user pool. It copies the committed seed in `cognito-local/` (pool `local_kanobi`, client `kanobilocalwebclient`, users `demo@kanobi.local` / `Kanobi-demo-1` and `other@kanobi.local` / `Kanobi-other-1`) on start.
- **frontend (:5173):** Vite with `VITE_API_URL=http://localhost:3000` and the cognito-local endpoint and client.

How `DEPLOY_TARGET=localstack` changes behaviour (`src/utils/awsConfig.ts`):
- Deploys run in `src/utils/localBuildRunner.ts` inside the backend container instead of CodeBuild. It follows the buildspec steps and adds `serverless-localstack` to the project's `serverless.yml`.
- The runner deploys with `serverless@3` to LocalStack and keeps build state and logs in S3 under `builds/<id>.json`.
- CloudFormation and API Gateway clients use `AWS_ENDPOINT`, and the cost endpoints return 0.

Newer LocalStack images need `LOCALSTACK_AUTH_TOKEN`. The compose file defaults to a pinned 4.x community image; override it with `LOCALSTACK_IMAGE` and `LOCALSTACK_AUTH_TOKEN` in a root `.env` (see `.env.example`). LocalStack runs Lambdas as sibling containers through the mounted Docker socket.

Without Docker, run `npm run start:local` in `backend-service` against your own LocalStack, with the env vars from `docker-compose.yml`.

## Tests

Both packages use Vitest with v8 coverage and enforce a **100% threshold** on lines, branches, functions and statements, so any uncovered new code fails `test:coverage`. Run a single file with `npx vitest run <path>` or a single test with `-t "<name>"`.

- Backend tests live in `backend-service/test/`, which mirrors `src/` and is kept outside `tsconfig` `include` so they are not compiled into `dist/`. AWS SDK v3 clients are mocked with `aws-sdk-client-mock` (`mockClient(DynamoDBDocumentClient)`, `mockClient(S3Client)`, …), and `aws-sdk` v2 and the `EventHub` with `vi.mock`. Codegen tests run the real ts-morph against `boilerplate/src/indexTemplate.ts`. Env vars (including `TZ=UTC`) are set in `vitest.config.mts`. Handlers read `SERVICE_TABLE ?? ""`, so handler suites run under `describe.each` with it set and unset.
- Frontend tests sit next to the code they cover (`*.test.tsx`), with jsdom and Testing Library. Render route components through `renderWithRouter` (`src/test/utils.tsx`) with a stub loader/action, and stub `fetch` (and `location` for `reload`) with `vi.stubGlobal`.
- Truly unreachable guards are excluded with `/* v8 ignore if -- @preserve */` (the `@preserve` is required so the TS transform keeps the comment). Known bugs, including the ones those hints cover, are tracked in `TODO.md`.

### E2E tests (Playwright)

- **What they cover:** user flows through the real app (UI → API → LocalStack), not units. They live in `frontend-service/src/e2e/`, mirror the path of the page or component they exercise (`src/components/ProjectCard.tsx` → `src/e2e/components/ProjectCard.e2e.tsx`), and use the `.e2e.tsx` extension. Shared fixtures are in `src/e2e/support/`.
- **Kept apart from unit tests:** Vitest excludes them, as does coverage, and `tsconfig.app.json` leaves them out. They typecheck through `tsconfig.e2e.json`, and run only with `npm run test:e2e`.
- **Stack lifecycle:** Playwright's global setup runs `docker compose up --build --wait` from the repo root, unless the UI and API are already responding, in which case it reuses them. Teardown stops only a stack that setup started. Set `E2E_KEEP_STACK=1` to leave it running. `E2E_BASE_URL` and `E2E_API_URL` override the default URLs (`localhost:5173` and `localhost:3000`).
- **Test data:** use the `api` fixture to create test data, and `uniqueName()` for names. Every project the fixture creates or tracks is deleted after the test, and tests run in parallel against one shared stack.
- **Locators:** prefer roles, labels and placeholders, with `{ exact: true }` where text overlaps. Fall back to `data-testid` (`project-card`, `model-card`) only for containers.
- **Deploy flow:** `ProjectDetail/ProjectDetails.e2e.tsx` builds and deploys a generated service to LocalStack, then calls its API. It takes a few minutes and needs internet access for `npm install`.
- **First run:** run `npx playwright install chromium` once.

CI (`.github/workflows/ci.yml`) runs on pushes to `main`, on PRs and on manual runs (`workflow_dispatch`), with Node 22. It has one job per package, plus an e2e job:
- **Backend:** `npm ci` → `typecheck` → `build` → `test:coverage`
- **Frontend:** `npm ci` → `lint` (non-blocking until the existing errors are fixed) → `build` → `test:coverage`
- **E2E** runs only on pushes to `main` (merges) and manual runs, not automatically on PRs. To run it for a PR, use Actions → CI → "Run workflow" on the PR's branch, or `gh workflow run CI --ref <branch>`. The manual run is attached to the PR's head commit (Actions tab, or the commit's checks), while the PR-triggered run keeps listing E2E as "skipped". Re-run it after pushing new commits. The job runs `npm ci` → `playwright install --with-deps chromium` → `test:e2e`, which starts the compose stack. On failure the job prints the compose logs. The Playwright report, traces and videos are uploaded as the `playwright-report` artifact.

Coverage reports are uploaded as artifacts. A coverage threshold failure fails the job.

### Testing rules (mandatory)

Coverage must stay at 100% in both packages, and every user-facing feature needs an e2e flow. Treat these as part of the definition of done for any change:

1. **Every code change ships with tests in the same change.** New or modified functions, branches, handlers, components, loaders and actions must have tests written or updated alongside them, not deferred to later.
2. **Run `npm run test:coverage` in each package you touched before you call the work done**, and make sure it passes. In the backend, also run `npm run typecheck`. A threshold failure is a failing build: fix it by adding tests, never by lowering thresholds, widening `coverage.exclude`, or deleting tests.
3. **Cover behaviour, not just lines.** For each branch, test both outcomes: success and failure paths, validation errors (400), not-found (404), unexpected errors (500), empty and missing data, and optional fields present and absent. Assert on outputs and side effects (response body, DynamoDB/S3 command inputs, published events, rendered UI, fetch calls), not just that code ran.
4. **`v8 ignore` hints are a last resort.** Use one only for code that genuinely can't be reached (e.g. a guard the UI or types make impossible). Add a comment explaining why and, if the unreachability points to a bug, an entry in `TODO.md`. Never use a hint to skip code that is merely hard to test; refactor it or mock the dependency instead.
5. **Bug fixes start with a test.** Write a test that reproduces the bug (it fails first), then fix it. If the bug is listed in `TODO.md`, update the test that documents the old behaviour and tick off or remove the entry.
6. **Keep tests isolated and deterministic.** In unit tests, no real network or AWS calls: mock SDK clients with `aws-sdk-client-mock`/`vi.mock`, and stub `fetch` and globals with `vi.stubGlobal`. Use fake timers or `vi.setSystemTime` for time-dependent code, and temp directories for filesystem work. Reset mocks and env stubs between tests (`restoreMocks` is on; call `vi.unstubAllEnvs()`/`vi.unstubAllGlobals()` where you stub).
7. **Where tests go:**
   - Backend tests go in `backend-service/test/` at the same relative path as the source (`src/utils/foo.ts` → `test/utils/foo.test.ts`).
   - Frontend tests sit next to the component as `*.test.ts(x)`.
   - E2E flows go in `frontend-service/src/e2e/` at the path of the page or component they exercise, as `*.e2e.tsx` (`src/components/ProjectCard.tsx` → `src/e2e/components/ProjectCard.e2e.tsx`).
   - Shared helpers go in `test/helpers.ts` (backend), `src/test/utils.tsx` (frontend) and `src/e2e/support/` (e2e).
8. **New source files are covered automatically** (the coverage `include` is `src/**`), so a new file without tests will fail the threshold. Don't add exclusions for new source files.
9. **Every new feature ships with e2e tests in the same change.** Unit tests alone are not enough for anything a user can see or do.
   - **What needs a flow:** a new page, dialog or form, a new action on a project or model, or a new or changed API that the UI calls. Write a Playwright flow that drives it through the UI and checks the result. Check what the UI shows, and also check through the `api` fixture that the change persisted (or that the generated service behaves).
   - **When you change an existing flow:** update its e2e test.
   - **Backend-only changes:** cover them with a flow through the UI feature that uses them. If no UI uses the change yet, say so in the PR.
   - **Cover more than the happy path:** include the main failure or cancel path the user can hit (validation alert, cancel or close, delete confirmation).
   - **Test data:** create it with the `api` fixture and `uniqueName()`, never with fixed names or shared records. Leave cleanup to the fixture.
   - **Locators:** prefer roles, labels and placeholders, with `{ exact: true }` where text overlaps. If an element has no accessible name, give it one (`aria-label`) rather than reaching for CSS classes, and use `data-testid` only for containers.
   - **Before calling the work done**, run `npm run test:e2e` in `frontend-service` and make sure every flow passes. It starts the Docker stack if needed. A failing or flaky flow is a failing build: fix the app or make the test wait properly with web-first `expect` assertions and `toPass`, never with fixed sleeps, `test.skip` or deleted assertions.

## Backend architecture

**Handlers.** `src/api/{project,model,deployment}/` each hold:
- `<name>.ts`: HTTP Lambda handlers. Each exported function is registered by name in `serverless.yml`, so a new endpoint has to be added there as well.
- `<name>.dto.ts`: zod schemas and types for request validation and DynamoDB items
- `<name>Event.ts`: async event handlers that do the heavy work (codegen, S3, CloudFormation, CodeBuild)

**Event flow.** HTTP handlers write to DynamoDB, then call `EventHub.Get().publish({type, payload})` (`src/utils/eventhub.ts`). When `NODE_ENV=dev`, `LocalEventHub` calls the handler in-process. Otherwise, `LambdaEventHub` invokes the Lambda `project-kanobi-${STAGE_NAME}-${handler.name}` asynchronously. A new event therefore needs to be registered in both hub classes **and** declared as a function in `serverless.yml`, and the function name in serverless.yml must equal the handler's JS name.

**Single-table DynamoDB.** The table name comes from `SERVICE_TABLE`, with `pk`/`sk` keys. All items for a project share `pk = "pr_<projectId>"`. Sort keys use the prefixes in `src/utils/keys.ts`: `pr_` for the project row, `ml_` for models, `dp_` for deployments. Each item also has `entityType`. Use `getPutOperators` (`src/utils/dynamodbHelpers.ts`) to build UpdateExpressions.

**Code generation pipeline (the core of the system):**
1. `backend-service/boilerplate/` is the template for generated services. At runtime it is read from the **S3 bucket** (`BUCKET_NAME`) under the `boilerplate/` prefix, not from local disk, so local edits to it take effect only after you upload it to the bucket.
2. `projectCreatedHandler` copies `boilerplate/` to `<projectId>/` in S3. It uses ts-morph to produce `src/index.ts` from the imports in `indexTemplate.ts`. It also rewrites the generated `serverless.yml` (service name from `getServiceName`, a per-project files bucket, IAM statements, `Service`/`Project` tags used for cost lookup).
3. `modelCreated/Updated/DeletedHandler` (`modelEvent.ts`) use `src/utils/codeBuilder.ts`, which clones the generic handlers from `indexTemplate.ts` (`Getone`, `Get`, `Post`, …) into `index.ts` as `<Method><ModelName>` functions via ts-morph. They also add or remove matching `functions` entries and per-model DynamoDB tables (`getTableName`) in the project's `serverless.yml`, then upload both files back to S3.
4. `deploymentTriggeredHandler` downloads `<projectId>/` from S3 (to `./.downloads` in dev, `/tmp` otherwise), zips it, uploads the zip, and starts the CodeBuild project `kanobi-deploy-<stage>` (`CODEBUILD_PROJECT`, defined in `serverless.yml`) with an inline buildspec (build, `docs.js` swagger generation, `sls deploy --stage prod`). `deployment.ts` reads the deployment status back through CodeBuild/CloudWatch logs and exports Swagger from API Gateway (`src/utils/infraHelper.ts`).
5. Deleting a project deletes its S3 folder and the CloudFormation stack (it empties the stack's buckets first).

**Environment.** Variables are read from `.env` (`useDotenv`, gitignored; copy `backend-service/.env.example`): `NODE_ENV`, `SERVICE_TABLE`, `DYNAMODB_ENDPOINT`, `S3_ENDPOINT`, `AWS_DEPLOY_REGION`, `BUCKET_NAME`, plus `CODEBUILD_PROJECT` and `CFN_EXECUTION_ROLE_ARN` (set from `serverless.yml` resources when deployed). With `NODE_ENV=dev`, the DynamoDB and S3 clients use the local endpoints. AWS calls such as CodeBuild, CloudFormation and Cost Explorer still go to real AWS.

**Credentials and IAM.** There are no static AWS keys. Clients for real AWS get no `credentials`, so the SDK's default chain resolves the Lambda execution role (or your profile locally). Clients pointed at a local emulator get dummy `test`/`test` credentials (`localEndpointConfig` in `src/utils/awsConfig.ts`). The control-plane role in `serverless.yml` lists only the actions and resources the code uses, so a new AWS call needs a matching IAM statement. Builds run as `DeployProjectRole`, and CloudFormation creates and deletes generated services' resources as `CfnExecutionRole` (`provider.iam.deploymentRole`, set in `projectEvent.ts`).

**Auth and ownership.** Every HTTP function except `Health` has the Cognito authorizer (`custom.cognitoAuthorizer` in `serverless.yml`); the local dev server verifies the ID token itself (`src/local/tokenVerifier.ts`, configured by `COGNITO_ISSUER`, `COGNITO_JWKS_URI`, `COGNITO_CLIENT_ID`). Handlers read the user with `getUserId(event)` and check projects with `requireProjectOwner(projectId, userId)` (`src/utils/auth.ts`), mapping errors with `authErrorResponse`. Project rows carry `ownerId`, and `GetProjects` queries the `byOwner` index. Handler tests get a signed-in user from `apiEvent()` by default (`userId: null` for none) and need the project row mocked with `GetCommand`.

Responses go through `ResponseManager` (`src/utils/responseManager.ts`), and logging goes through `logInfo`/`logError` (`src/utils/logger.ts`). CORS allows `CORS_ORIGIN` (any origin when unset).

## Frontend architecture

**UI redesign:** the screens are in the [Project Kanobi Figma file](https://www.figma.com/design/K9vwhf5Vuc2hg0BYLznZRS/Project-Kanobi), with a local gitignored export in `figma-screenshot/`. Before building or changing any screen, read `DESIGN.md`, which overrides the designs where they're inconsistent or show features Kanobi doesn't have. It defines the app shell, the `StatusPill` variants, the real endpoint and response formats, and what to hide until the backend supports it. Update `DESIGN.md` in the same change when a hidden feature gets built.

Routes are defined in `src/main.tsx` with `createBrowserRouter`. Each page folder (`Login/`, `Project/`, `ProjectDetail/`) pairs a component with `loader.ts`/`action.ts`, and data fetching and mutations happen in those files, not in components. Actions dispatch on a hidden `action` form field (`post`/`put`/`delete`). The backend base URL is `API_URL` (`src/config.ts`), read from `VITE_API_URL`: `.env.development` (localhost:3000), `.env.production` (the staging API Gateway endpoint), or `.env.test`.

**Auth.** Sign in (`src/auth.ts`) calls Cognito's `InitiateAuth` (`USER_PASSWORD_AUTH`) at `VITE_COGNITO_ENDPOINT` with `VITE_COGNITO_CLIENT_ID`, and keeps the session in `sessionStorage`. Call the API only through `apiFetch` (`src/api.ts`), which sends the ID token, renews it once on a 401, and otherwise signs out and opens `/?expired=1`. Signed-in pages are children of the `Layout` route, whose loader (`requireAuth`) redirects to Sign in with `redirectTo`. In unit tests, put a session in `sessionStorage` (`kanobi.session`) to assert the `Authorization` header; in e2e, sign in with `login(page)` and use the `api`/`otherApi` fixtures, which act as the two seeded users.
