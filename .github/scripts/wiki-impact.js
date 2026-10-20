// Decides whether a merged PR changed enough documented code to need a wiki
// update and, if so, opens one issue that lists the wiki pages to review.
// Runs from .github/workflows/wiki-update-issues.yml through actions/github-script.
// Tests: node --test ".github/scripts/*.test.js"

/** Changed lines (additions + deletions) in documented files that make a PR significant. */
const DEFAULT_MIN_CHANGED_LINES = 50;

/** Files listed per page in the issue before "…and N more". */
const MAX_FILES_PER_PAGE = 15;

/** A PR with this label, or "[skip wiki]" in its description, never gets an issue. */
const OPT_OUT_LABEL = "skip-wiki";

// Files that never need a wiki change: test cases, lockfiles, prose and the
// wiki checkout itself. Test *infrastructure* (helpers, setup, e2e support) is
// not listed here, so it still maps to the Testing page.
const IGNORED = [
  /\.test\.[jt]sx?$/,
  /\.e2e\.tsx$/,
  /^backend-service\/test\/(?!helpers\.ts$|setup\.ts$|tsconfig\.json$)/,
  /package-lock\.json$/,
  /\.md$/,
  /^wiki\//,
  /^figma-screenshot\//,
];

// Each rule maps paths to the wiki pages that describe them. A `key` rule is
// significant on its own, whatever the size of the change: these files define
// routes, schemas, generated code, setup or CI, which the wiki spells out.
// A file can match several rules; its pages are combined.
const RULES = [
  {
    pages: ["API-Reference", "Architecture", "Installation"],
    key: true,
    paths: [/^backend-service\/serverless\.yml$/],
  },
  {
    pages: ["API-Reference"],
    key: true,
    paths: [/^backend-service\/src\/api\/.+\.dto\.ts$/, /^backend-service\/src\/types\.ts$/],
  },
  {
    pages: ["API-Reference", "Usage-Guide"],
    key: true,
    paths: [/^backend-service\/src\/utils\/names\.ts$/, /^frontend-service\/src\/validation\.ts$/],
  },
  {
    pages: ["Code-Generation", "API-Reference"],
    key: true,
    paths: [
      /^backend-service\/boilerplate\//,
      /^backend-service\/src\/utils\/codeBuilder\.ts$/,
      /^backend-service\/src\/api\/model\/modelEvent\.ts$/,
    ],
  },
  {
    pages: ["Installation"],
    key: true,
    paths: [
      /^docker-compose\.ya?ml$/,
      /^\.env\.docker\.example$/,
      /^localstack\//,
      /^cognito-local\//,
      /(^|\/)Dockerfile$/,
      /^backend-service\/\.env\.example$/,
      /^frontend-service\/\.env\.[a-z]+$/,
      /^frontend-service\/\.npmrc$/,
    ],
  },
  {
    pages: ["Testing"],
    key: true,
    paths: [
      /^\.github\/workflows\//,
      /^backend-service\/vitest\.config\.m?ts$/,
      /^backend-service\/test\/(helpers|setup)\.ts$/,
      /^backend-service\/test\/tsconfig\.json$/,
      /^frontend-service\/vitest\.config\.ts$/,
      /^frontend-service\/playwright\.config\.ts$/,
      /^frontend-service\/src\/e2e\/support\//,
      /^frontend-service\/src\/test\//,
    ],
  },
  {
    pages: ["Architecture", "Usage-Guide"],
    key: true,
    paths: [/^frontend-service\/src\/main\.tsx$/],
  },
  {
    pages: ["Installation", "Testing"],
    paths: [/^(backend|frontend)-service\/package\.json$/],
  },
  {
    pages: ["API-Reference", "Architecture"],
    paths: [/^backend-service\/src\/api\//],
  },
  {
    pages: ["Architecture", "Installation"],
    paths: [
      /^backend-service\/src\/local\//,
      /^backend-service\/src\/utils\/(awsConfig|localBuildRunner)\.ts$/,
    ],
  },
  {
    pages: ["Architecture"],
    paths: [
      /^backend-service\/src\/(utils|scripts)\//,
      /^frontend-service\/src\/(api|auth|config)\.ts$/,
      /^frontend-service\/src\/Layout\//,
    ],
  },
  {
    pages: ["Usage-Guide"],
    paths: [/^frontend-service\/src\/(Login|Project|ProjectDetail|Layout|components)\//],
  },
];

// Adding, removing or renaming a file here changes the tree in Project-Structure.
const STRUCTURE_PATHS = [
  /^backend-service\/src\//,
  /^backend-service\/boilerplate\//,
  /^frontend-service\/src\//,
  /^\.github\//,
];
const STRUCTURE_STATUSES = new Set(["added", "removed", "renamed"]);

// Area labels that already exist in the repo.
const AREA_LABELS = [
  { label: "generated-api", paths: [/^backend-service\/boilerplate\//, /^backend-service\/src\/utils\/codeBuilder\.ts$/] },
  { label: "backend", paths: [/^backend-service\//] },
  { label: "frontend", paths: [/^frontend-service\//] },
];

const matches = (patterns, filename) => patterns.some((p) => p.test(filename));
const churn = (f) => (f.additions || 0) + (f.deletions || 0);

/**
 * Works out which wiki pages a PR's files affect and whether the change is big
 * enough to need an update. `files` are GitHub's PR file entries
 * ({ filename, status, additions, deletions, previous_filename }).
 */
function analyze(files, { minChangedLines = DEFAULT_MIN_CHANGED_LINES } = {}) {
  const pages = {};
  const keyFiles = [];
  const structureFiles = [];
  const labels = new Set();
  let totalChangedLines = 0;
  let mappedFiles = 0;

  const addToPage = (page, f) => {
    pages[page] ??= [];
    if (!pages[page].includes(f)) pages[page].push(f);
  };

  for (const f of files) {
    if (matches(IGNORED, f.filename)) continue;

    const rules = RULES.filter((r) => matches(r.paths, f.filename));
    const isStructural =
      STRUCTURE_STATUSES.has(f.status) && matches(STRUCTURE_PATHS, f.filename);
    if (!rules.length && !isStructural) continue;

    mappedFiles++;
    totalChangedLines += churn(f);
    for (const rule of rules) rule.pages.forEach((page) => addToPage(page, f));
    if (rules.some((r) => r.key)) keyFiles.push(f.filename);
    if (isStructural) {
      structureFiles.push(f);
      addToPage("Project-Structure", f);
    }
    for (const area of AREA_LABELS) {
      if (matches(area.paths, f.filename)) labels.add(area.label);
    }
  }

  const reasons = [
    ...keyFiles.map((name) => `Key file changed: \`${name}\``),
    ...(structureFiles.length
      ? [`${structureFiles.length} source file(s) added, removed or renamed`]
      : []),
    ...(totalChangedLines >= minChangedLines
      ? [`${totalChangedLines} lines changed in documented code (threshold ${minChangedLines})`]
      : []),
  ];

  return {
    significant: reasons.length > 0,
    reasons,
    pages,
    labels: [...labels].sort(),
    totalChangedLines,
    mappedFiles,
  };
}

/** True when the PR asked not to get a wiki issue. */
function isOptedOut(pr) {
  const labelled = (pr.labels ?? []).some((l) => l.name === OPT_OUT_LABEL);
  return labelled || /\[skip wiki\]/i.test(pr.body ?? "");
}

/** Hidden marker that ties an issue to its PR, so a re-run never duplicates it. */
const marker = (prNumber) => `<!-- wiki-update-pr:${prNumber} -->`;

const truncate = (text, max) => (text.length > max ? text.slice(0, max - 1) + "…" : text);

const describeFile = (f) => {
  const from = f.previous_filename ? `, renamed from \`${f.previous_filename}\`` : "";
  return `\`${f.filename}\` (+${f.additions || 0}/−${f.deletions || 0}, ${f.status}${from})`;
};

/** The issue's title, body and labels for a significant PR. */
function buildIssue(pr, analysis, { owner, repo }) {
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const merged = pr.merged_at ? ` merged on ${pr.merged_at.slice(0, 10)}` : "";

  const pageSections = Object.keys(analysis.pages)
    .sort()
    .map((page) => {
      const files = analysis.pages[page];
      const shown = files.slice(0, MAX_FILES_PER_PAGE).map((f) => `  - ${describeFile(f)}`);
      const more = files.length > MAX_FILES_PER_PAGE
        ? [`  - …and ${files.length - MAX_FILES_PER_PAGE} more`]
        : [];
      return [`- [ ] [${page}](${repoUrl}/wiki/${page})`, ...shown, ...more].join("\n");
    });

  const body = [
    marker(pr.number),
    `PR [#${pr.number}](${pr.html_url}) **${pr.title}** by @${pr.user?.login ?? "unknown"}${merged} changed code that the wiki documents.`,
    "",
    "### Why this issue was opened",
    ...analysis.reasons.map((r) => `- ${r}`),
    "",
    "### Pages to review",
    "Tick each page once it matches the code (or once you've checked it needs no change).",
    "",
    ...pageSections,
    "",
    "### How to update",
    `1. Read the PR diff: ${pr.html_url}/files`,
    `2. Edit the pages: \`git clone ${repoUrl}.wiki.git\` (or pull your \`wiki/\` checkout), or edit them on ${repoUrl}/wiki.`,
    "3. Push the wiki, then close this issue with a link to the wiki commit.",
    "",
    "If the wiki needs no change, close this issue as *not planned*.",
    `To skip this check on a future PR, add the \`${OPT_OUT_LABEL}\` label or write \`[skip wiki]\` in its description.`,
  ].join("\n");

  return {
    title: truncate(`Update wiki for #${pr.number}: ${pr.title}`, 200),
    body,
    labels: ["documentation", ...analysis.labels],
  };
}

/**
 * Entry point for actions/github-script. The PR comes from the
 * pull_request_target payload, or from PR_NUMBER on a manual run.
 * DRY_RUN=true writes the issue to the job summary instead of creating it.
 */
async function run({ github, context, core, env = process.env }) {
  const { owner, repo } = context.repo;
  const dryRun = env.DRY_RUN === "true";
  const parsedMin = Number.parseInt(env.WIKI_MIN_CHANGED_LINES ?? "", 10);
  const minChangedLines = Number.isNaN(parsedMin) ? DEFAULT_MIN_CHANGED_LINES : parsedMin;

  let pr = context.payload.pull_request;
  if (!pr && env.PR_NUMBER) {
    ({ data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: Number(env.PR_NUMBER) }));
  }
  if (!pr) throw new Error("No pull request: run on pull_request_target or set PR_NUMBER");

  const skip = (reason) => {
    core.info(`#${pr.number}: ${reason}`);
    return { action: "skipped", reason };
  };

  if (!pr.merged && !dryRun) return skip("not merged, nothing to document");
  if (isOptedOut(pr)) return skip(`opted out (${OPT_OUT_LABEL} label or [skip wiki])`);

  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  });
  const analysis = analyze(files, { minChangedLines });
  core.setOutput("significant", String(analysis.significant));

  if (!analysis.significant) {
    return skip(
      `${analysis.totalChangedLines} documented lines changed, below the threshold of ${minChangedLines}, and no key files`
    );
  }

  const issue = buildIssue(pr, analysis, { owner, repo });

  if (dryRun) {
    await core.summary.addHeading(`Dry run: ${issue.title}`).addRaw(issue.body).write();
    core.info(`Dry run: would open "${issue.title}"`);
    return { action: "dry-run", issue };
  }

  const existing = (
    await github.paginate(github.rest.issues.listForRepo, {
      owner,
      repo,
      state: "all",
      labels: "documentation",
      creator: "github-actions[bot]",
      per_page: 100,
    })
  ).find((i) => (i.body ?? "").includes(marker(pr.number)));
  if (existing) {
    core.info(`#${pr.number}: wiki issue already exists: ${existing.html_url}`);
    return { action: "exists", url: existing.html_url };
  }

  const { data: created } = await github.rest.issues.create({ owner, repo, ...issue });
  core.setOutput("issue-url", created.html_url);
  await core.summary.addHeading(`Opened ${issue.title}`).addRaw(created.html_url).write();
  core.info(`Opened ${created.html_url}`);
  return { action: "created", url: created.html_url, issue };
}

module.exports = {
  analyze,
  buildIssue,
  isOptedOut,
  marker,
  run,
  DEFAULT_MIN_CHANGED_LINES,
};
