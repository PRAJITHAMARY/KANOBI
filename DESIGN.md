# Design implementation guide

The UI redesign is in Figma ([Project Kanobi](https://www.figma.com/design/K9vwhf5Vuc2hg0BYLznZRS/Project-Kanobi)), which is the shared copy of all 12 screens. Screen names below (e.g. `Kanobi - Sign In (Light)`) are the Figma frame names. A local, gitignored export may also exist in `figma-screenshot/`. The designs have inconsistencies and show features Kanobi doesn't have, and they won't be updated. **This file records the corrections. When building a screen, follow this file wherever it disagrees with the design.**

Precedence, highest first:

1. This file.
2. `TODO.md`: "Design features we can't support" (never build these as drawn) and "Features in the designs that we don't have yet" (build only once the backend exists).
3. The screenshots, for layout, spacing, hierarchy and visual style.

General rule: **build what the backend supports today and leave out the rest.** Don't ship placeholders, sample data, disabled "coming soon" controls or invented copy for missing features. When a feature from `TODO.md` is built, add its UI then and update this file.

---

## 1. Global rules (apply to every screen)

### 1.1 App shell

The designs show several variants of the sidebar and header. Use one:

- **Logo:** the blue "stacked layers" mark plus the word "Kanobi", everywhere, including the auth screens (the designs also use a terminal icon and a cube). No "BaaS" badge.
- **Sidebar:**
  - nav items **Projects**, **Settings**, **Docs**
  - user card at the bottom: name, email, and a menu with Sign out
  - inside a project, a **project switcher** above the nav (the "PROJECT / Shop API" variant)
  - no workspace or org switcher (`acme-production`): workspaces don't exist
  - don't add a "WORKSPACE" section label; it wraps as "WORKSP / ACE" in two designs
  - Settings and Docs appear only once those pages exist
- **Top bar:** the ⌘K search, notifications bell and help icon are **hidden** until built (`TODO.md` → Overall). Keep the avatar.
- **Breadcrumb:** `Projects / <project name>`. There's no environment segment; the designs show `production`, but environments don't exist.

### 1.2 Project header (all project tabs)

- **Title row:** project name, then the status pill (see 1.3), then an edit (pencil) icon.
- **Description:** below the title. **Omit it when empty**; never render `[short description]`.
- **Base URL:**
  - a copy chip with the full URL, shown **only when the latest deployment succeeded** (`deployment.baseUrl`)
  - the real format is `https://<api-id>.execute-api.<region>.amazonaws.com/prod`, not `api.kanobi.dev/...`
- **Deploy button:** "Deploy changes".
  - **No pending-changes count badge** until that's tracked.
  - Disabled while `deployment.isDeploying`, with a tooltip "A deployment is already in progress".
- **Tabs:** one tab bar with **Models · Deployments · API Docs · Cost · Settings**. The API Docs empty-state design shows two tab bars; render only one.

### 1.3 Status pill: one component, four variants

The designs draw status at least four different ways. Build a single `StatusPill` and use it everywhere: cards, project header, deployment history.

| Variant | Colour | Shown when |
|---|---|---|
| Not deployed | slate | no deployment record |
| Deploying | amber, with spinner | `deployment.isDeploying` |
| Live | green | latest `buildStatus === "SUCCEEDED"` |
| Failed | red | latest `buildStatus` is `FAILED`, `FAULT`, `TIMED_OUT` or `STOPPED` |

Use sentence case ("Deploying"), never uppercase ("IN PROGRESS").

### 1.4 Visual tokens

- **Fonts:** Inter for UI. A monospace font (JetBrains Mono) **only** for code, ids, URLs, endpoint paths, field names, money amounts and logs. **Don't** use mono for error messages, labels, table headers or pill text; the designs overuse it.
- **Colours:** light theme on a slate-50 page background with white surfaces, one blue primary (≈ `#2563EB`), green/amber/red for status, 1px slate borders. Take exact values from the Figma file rather than these approximations. Define them as Tailwind theme tokens, not one-off hex values.
- **Shape and spacing:** 8px spacing grid, 8–12px corner radius, borders rather than heavy shadows (modals may use a shadow).

### 1.5 Forms, modals and validation

- **Button order:** primary action on the **right**, Cancel to its left as a visible secondary button with `type="button"` (the "Cancel buttons submit their forms" bug in `TODO.md` is fixed in the current dialogs). The New project design has them left-aligned.
- **Validation timing:** show field errors on **blur or submit**, not while the user is typing. Exception: type-to-confirm inputs stay neutral and keep the action button disabled until the value matches (the Delete modal design shows a red error mid-typing).
- **Form-level errors** (e.g. bad credentials): a neutral-red banner above the fields, in the regular UI font, with no single field highlighted.
- **Modals:** close with ✕, Escape and Cancel. The backdrop shows the real underlying page (the designs show unrelated mock dashboards behind the modals).

### 1.6 Content and copy

- **No sample data.** Never ship "Alex Rivera", "acme", `analytics-pipeline`, `$18.42`, the commit `8f2b31c` and so on from the designs. Render real data, or an empty state.
- **No claims for features we don't have:** GraphQL, Postgres, JWT, edge caching, micro-VPC, Prisma, migrations, templates, OpenAPI import, typed SDKs, git deploys, rate limits, idempotency, scopes, budgets. See both feature lists in `TODO.md`.
- **Use the real formats Kanobi generates:**
  - **Endpoints:** for a model `Product`, exactly these seven, with the name as written (no lower-casing, no plural, no `/api/v1` prefix, no PATCH):

    | Method | Path |
    |---|---|
    | GET | `/Product/{id}` |
    | GET | `/Product` |
    | POST | `/Product` |
    | PUT | `/Product/{id}` |
    | DELETE | `/Product/{id}` |
    | POST | `/multiple-Product` |
    | DELETE | `/multiple-Product/{ids}` |

  - **Field types:** `string`, `number`, `boolean` only. Fields have a name, a type and a required flag; nothing else (no enum, format, default, nullable or object types).
  - **Relationship types:** `one-to-one`, `one-to-many`, `many-to-one`, `many-to-many`.
  - **Responses:** `{ "data": …, "message": "ok" | "created", "meta": {} }`. Ids are plain UUIDs. There's no `createdAt`.
  - **Region:** don't show a region unless the API returns one; it's a single deployment-wide setting, not per project.
- **Dates:** relative time ("12m ago") with the full timestamp in a tooltip. Copyright year from the current date, not "© 2025".

### 1.7 States every screen needs

Each screen must design-in, even where Figma doesn't show it:

- a loading skeleton
- an empty state
- an error state with Retry (no `alert()`)
- truncated text with a tooltip showing the full value

### 1.8 Accessibility and testability

- Icon-only buttons (copy, kebab, edit, delete, ✕) need an `aria-label`. This is also how e2e tests locate them (see CLAUDE.md → Testing rules).
- Use `data-testid` only on containers (`project-card`, `model-card`).
- Every toggle and checkbox has a visible or `aria` label.

---

## 2. Screen by screen

Each section lists what to build and where to deviate from the design.

### Sign in (Figma: `Kanobi - Sign In (Light)`)

- **No backend accounts yet** (`TODO.md` → Accounts). Until they exist, build the Sign in layout around the current login, and **hide**:
  - "Forgot password?"
  - "Continue with Google/GitHub"
  - "Sign up"
  - "All systems normal"
- **Logo:** show it once, inside the card. Remove the duplicate in the page header.
- **Error:** "Invalid email or password" as a form-level banner (1.5), not mono, and don't highlight only the password field.

### Sign up and Email verification

- Not built until accounts exist.
- When built, Sign up must reuse the Sign in components exactly: white inputs, label spacing and type sizes. The design's grey inputs, cramped labels and green "Already have an account?" text are mistakes. Remove the stray rectangle under the card. Add a password requirements hint.
- **Verification also needs:**
  - paste support for the whole 6-digit code
  - Verify disabled until 6 digits are entered
  - a resend countdown
  - invalid and expired code states
  - "Wrong email? Change it"
  
  Drop the blurred background blob.

### Projects dashboard (Figma: `Kanobi - Projects Dashboard (Light)`)

- **Header:** "Projects", a count, the filter input (client-side, by name), "New project". **No sort control** until projects have timestamps, and **no `/` key hint** next to the filter.
- **Card:**
  - name: up to 2 lines, then ellipsis and a tooltip; never on the same line as the pill
  - status pill on its own row (1.3)
  - description: 2 lines max
  - the base URL with a copy button when Live
  - kebab menu with Edit and Delete
  - omit model/endpoint counts, "last deployed" and cost per card until the list API returns them (`TODO.md` → Projects dashboard). Never fetch per card.
  - "8 endpoints" must not wrap
- **"Start from scratch" card:** replace it with a plain **"New project"** card (same action as the header button). No templates, no GraphQL copy.
- **Metrics strip** (instances, requests, P95, projected bill): **omit**.

### Projects empty state (Figma: `Kanobi - Projects Empty State (Light)`)

- Hide the filter input and search when there are no projects.
- The subtitle under "Projects" must not wrap into a narrow column; use full width or drop it.
- **Feature cards:** replace all three (they claim Postgres, GraphQL, JWT, micro-VPC) with the real steps: **Define models → Generate endpoints → Deploy to AWS**, one sentence each.
- **Links:** keep at most one secondary link (quickstart docs, once Docs exists). Remove "Import from OpenAPI spec" and "Browse templates".

### New project modal (Figma: `Kanobi - New Project Modal (Light)`)

- **Fields:** Project name and Description (optional). **Remove "AWS Deployment Region".**
- **Name rule:** lowercase letters, numbers and hyphens, 3+ characters, validated client-side on blur and submit, and enforced by the API. Show the rule as a single hint line, and drop the "3+ chars" chip that repeats it.
- **Footer:** Cancel and Create project, right-aligned (1.5).

### Delete project modal (Figma: `Kanobi - Delete Project Modal (Light)`)

- **Keep:** the red header strip, the warning callout, type-to-confirm and the disabled destructive button. This is the reference design for destructive confirms.
- **Input:** stays neutral until the name matches. No "Name does not match yet" error while typing (1.5).
- **Impact list:** what is actually removed:
  - the model DynamoDB tables and their data
  - the Lambda functions and API Gateway API
  - the project's S3 files bucket
  - generated source and deployment history
  
  Remove the region row.
- **Billing copy:** "Resources are removed within a few minutes. Charges already incurred will still be billed." Not "Terminates immediately" (`TODO.md` → can't support).

### Project Settings tab (no design)

Build it from the shared components:

- General: name with the same rule as New project, description, Save
- Deployment info, read-only: base URL, stack name, last deployed
- Danger zone: Delete, which opens the Delete modal

### Data Model Editor (Figma: `Kanobi - Data Model Editor (Light)`)

- **Layout:** keep the 3 columns: model list, editor, ER diagram (collapsible).
- **Model list:** name, field count, an unsaved-changes dot, "+ Add". Every model referenced anywhere on the screen must be in this list (the design shows `Cart` in relationships and the diagram but not in the list).
- **Header:** editable name, and the description as an auto-growing textarea, not a truncating single-line input.
- **Fields table:**
  - first row: the system `id` field, shown as "id · uuid · auto-generated" with a lock icon and **no Required toggle**
  - other rows: name as an inline-editable mono input (border on hover and focus), type as a **dropdown** with a chevron (string, number, boolean), Required as a checkbox or toggle, delete icon
  - helper text: "Required is shown in API docs." The generated API doesn't enforce it yet (`TODO.md`).
  - duplicate names: inline row error, as designed
- **Relationships:**
  - each row: target model and type, plus the explanation line, which is correct as designed
  - replace "foreign key: `userId`" with how it's actually stored: "stored on Order as `User` (id)", or `User (id[])` on the many side
- **Generated endpoints:**
  - the seven real routes (1.6) with on/off toggles
  - plain descriptions only: "Get one Product by id", "List all Products", "Create a Product", "Update a Product", "Delete a Product", "Create many Products", "Delete many Products by comma-separated ids"
  - an off route reads "Not generated", not "disabled by policy"
  - no "cursor pagination", "validation", "soft delete" or "bulk purge" wording
- **Diagram panel:** replace "Modifying schema will stage a migration script" with "Changes take effect on your next deploy." Add an Expand button for a full-size diagram (the thumbnail text is unreadable).
- **Sticky footer:** "Unsaved changes in <Model>", Discard, Save model. **Save is disabled while any error exists.** Add the hint "Saved changes go live with Deploy changes."

### Deployments (Figma: `Kanobi - Deployments & Live Build Status (Light)`)

- **Data available today:** one deployment record per project, with:
  - `isDeploying`, `buildStatus`, `currentPhase`, `buildComplete`
  - `triggeredAt`, `deployedAt`
  - `log`, `baseUrl`, `apiId`
  
  Build only what this supports.
- **Status cards:** status (StatusPill), current phase, started or last deployed time. Remove the separate "API endpoint" card; the URL is already in the header. Remove commit, branch and "Deploying commit … to us-east-1" text.
- **Stage tracker:** map CodeBuild `currentPhase` into **3 stages** (Build and Deploy are one stage until the buildspec is split, see `TODO.md`):

  | Stage | CodeBuild phases |
  |---|---|
  | Queued | `SUBMITTED`, `QUEUED`, `PROVISIONING` |
  | Install | `DOWNLOAD_SOURCE`, `INSTALL`, `PRE_BUILD` |
  | Build & deploy | `BUILD`, `POST_BUILD`, `UPLOAD_ARTIFACTS`, `FINALIZING` |
  | (complete) | `COMPLETED`, with `buildStatus` deciding success or failure |

- **Log viewer:**
  - real log text from `deployment.log`, with line numbers, copy and download
  - the panel fills the remaining viewport height (the design leaves a large empty area)
  - "Auto-refreshing every 10s" while deploying; no "streaming in real time" claim and no "Ctrl + C" footer
  - never show fake pnpm/esbuild/CDK/git lines
- **Failed state** (not in the design; build it): a red summary card with the failed phase, the last error lines from the log, "Jump to error" and **Retry deploy**.
- **Never deployed:** an empty state explaining what a deploy does, plus "Deploy now".
- **Hide until the backend supports them:** deployment history, "Load earlier deployments", the velocity chart, Cancel deploy.

### API Docs: empty state (Figma: `Kanobi - API Docs Empty State (Light)`)

- One tab bar (1.2). The header status follows the real deployment; the design shows "Live" next to "Awaiting first generation".
- **Headline:** "Deploy your project to generate API docs". Body: "Interactive OpenAPI documentation is generated each time you deploy." No OpenAPI 3.1, SDK or sandbox claims.
- **Buttons:** "Deploy changes" (same action as the header) and "Go to Models".
- **Preview:** use the real route list for the project's models (1.6). Remove "Auto-synced to Prisma / GraphQL AST" and the fake response and "Send Request".

### API Docs: populated (Figma: `Kanobi - API Docs & OpenAPI Console (Light)`)

- **Until the custom explorer is built** (`TODO.md`), render the spec with Swagger UI, restyled to the tokens in 1.4.
- **When building the explorer:**
  - **Left:** search, and endpoints grouped **by model** with the seven real routes. Routes that are off appear greyed with "Not generated — enable it in Models".
  - **Endpoint header:**
    - method and path, and a plain summary
    - an amber **"Public endpoint — no authentication"** badge (generated APIs are public; see Security in `TODO.md`)
    - **remove** the Bearer Token badge, the rate limit, latency, idempotency and scope stats, and the event and email copy
  - **Parameters:**
    - `GET` routes take the `includes` query parameter (`true`, or comma-separated model names)
    - remove `notify`
  - **Request body:**
    - fields from the model: name, type, required
    - plus `includes: array of { model, id }`, described as "link related records"
    - no enums, formats, defaults, nullable or object types
  - **Console:** a sticky right column on wide screens. Request editor and Send. The response shows status, time and size, and the real envelope `{ data, message, meta }`. Design the 4xx/5xx, loading and no-results states.
  - **Code snippets:** cURL, TypeScript (fetch), Python and Go, using the real base URL and **no `Authorization` header**.

### Cost (Figma: `Kanobi - Cost & AWS Usage (Light)`)

- **Data available today:** `GET /project/cost/{id}` → current month-to-date and projected amounts, with currency.
- **Build:**
  - the two stat cards, "Month to date" and "Projected this month"
  - the note "Costs come from AWS Cost Explorer and may lag by up to 24 hours. Updated <time>."
  - an empty or zero state for projects that have never been deployed (in local LocalStack mode the cost is always 0)
- **Hide until built:**
  - the daily spend chart (also broken in the design: no bars, misplaced axis labels)
  - the per-service table and usage volume
  - the allocated budget card
  - the date range picker, Export CSV, "vs prev cycle" trend and the AWS Cost Management link
- **Never:** hourly or real-time cost wording (`TODO.md` → can't support). Remove the "us-east-1 production" pill and the region text.
- The subtitle must not wrap the project name ("Shop / API").

---

## 3. Keeping this file current

- When a feature from `TODO.md` gets built, update the matching "hide until" line here in the same change.
- When the designs are updated in Figma or `figma-screenshot/`, re-check the deviations above and delete the ones that are fixed.
- New screens without a design: build them from the shared components and rules in section 1, and add a short section here.
