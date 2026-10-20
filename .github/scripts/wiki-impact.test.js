// Tests for wiki-impact.js. Run with: node --test ".github/scripts/*.test.js"
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  analyze,
  buildIssue,
  isOptedOut,
  marker,
  run,
  DEFAULT_MIN_CHANGED_LINES,
} = require("./wiki-impact");

const file = (filename, additions = 1, deletions = 0, status = "modified") => ({
  filename,
  additions,
  deletions,
  status,
});

const pr = (overrides = {}) => ({
  number: 42,
  title: "Add a thing",
  body: "",
  merged: true,
  merged_at: "2026-10-20T10:00:00Z",
  html_url: "https://github.com/acme/kanobi/pull/42",
  user: { login: "octocat" },
  labels: [],
  ...overrides,
});

const REPO = { owner: "acme", repo: "kanobi" };

describe("analyze", () => {
  test("ignores tests, lockfiles, markdown and the wiki checkout", () => {
    const result = analyze([
      file("backend-service/test/api/project.test.ts", 500),
      file("frontend-service/src/Project/Projects.test.tsx", 500),
      file("frontend-service/src/e2e/Project/Projects.e2e.tsx", 500),
      file("backend-service/package-lock.json", 5000),
      file("TODO.md", 300),
      file("wiki/Home.md", 300),
    ]);
    assert.equal(result.significant, false);
    assert.equal(result.mappedFiles, 0);
    assert.deepEqual(result.pages, {});
    assert.deepEqual(result.reasons, []);
  });

  test("ignores files that no rule covers", () => {
    const result = analyze([file("frontend-service/public/vite.svg", 999)]);
    assert.equal(result.significant, false);
    assert.equal(result.mappedFiles, 0);
  });

  test("small changes to ordinary source stay below the threshold", () => {
    const result = analyze([file("backend-service/src/api/project/project.ts", 10, 5)]);
    assert.equal(result.significant, false);
    assert.equal(result.totalChangedLines, 15);
    assert.deepEqual(Object.keys(result.pages).sort(), ["API-Reference", "Architecture"]);
  });

  test("ordinary source over the threshold is significant", () => {
    const result = analyze([
      file("backend-service/src/api/project/project.ts", 30, 0),
      file("frontend-service/src/components/ProjectCard.tsx", 15, 5),
    ]);
    assert.equal(result.totalChangedLines, DEFAULT_MIN_CHANGED_LINES);
    assert.equal(result.significant, true);
    assert.match(result.reasons[0], /50 lines changed in documented code \(threshold 50\)/);
  });

  test("the threshold can be changed", () => {
    const files = [file("backend-service/src/api/project/project.ts", 10)];
    assert.equal(analyze(files, { minChangedLines: 10 }).significant, true);
    assert.equal(analyze(files, { minChangedLines: 11 }).significant, false);
  });

  test("a one-line change to a key file is significant on its own", () => {
    const result = analyze([file("backend-service/serverless.yml", 1)]);
    assert.equal(result.significant, true);
    assert.deepEqual(result.reasons, [
      "Key file changed: `backend-service/serverless.yml`",
    ]);
    assert.deepEqual(Object.keys(result.pages).sort(), [
      "API-Reference",
      "Architecture",
      "Installation",
    ]);
  });

  test("lists each key file once even when several rules match it", () => {
    const result = analyze([file("backend-service/src/api/model/model.dto.ts", 1)]);
    assert.equal(
      result.reasons.filter((r) => r.includes("model.dto.ts")).length,
      1
    );
  });

  test("maps codegen and template changes to Code-Generation", () => {
    const result = analyze([
      file("backend-service/boilerplate/src/indexTemplate.ts", 2),
      file("backend-service/src/utils/codeBuilder.ts", 2),
    ]);
    assert.equal(result.significant, true);
    assert.equal(result.pages["Code-Generation"].length, 2);
    assert.deepEqual(result.labels, ["backend", "generated-api"]);
  });

  test("maps test infrastructure, but not test cases, to Testing", () => {
    const result = analyze([
      file("backend-service/test/helpers.ts", 1),
      file("frontend-service/src/e2e/support/fixtures.ts", 1),
      file("frontend-service/playwright.config.ts", 1),
      file(".github/workflows/ci.yml", 1),
    ]);
    assert.equal(result.pages.Testing.length, 4);
    assert.deepEqual(result.labels, ["backend", "frontend"]);
  });

  test("adding, removing or renaming a source file touches Project-Structure", () => {
    const result = analyze([
      file("backend-service/src/utils/newThing.ts", 3, 0, "added"),
      file("frontend-service/src/components/Old.tsx", 0, 3, "removed"),
      { ...file("frontend-service/src/components/New.tsx", 0, 0, "renamed"), previous_filename: "frontend-service/src/components/Was.tsx" },
      file("backend-service/src/utils/keys.ts", 1, 0, "modified"),
    ]);
    assert.equal(result.significant, true);
    assert.deepEqual(
      result.pages["Project-Structure"].map((f) => f.filename),
      [
        "backend-service/src/utils/newThing.ts",
        "frontend-service/src/components/Old.tsx",
        "frontend-service/src/components/New.tsx",
      ]
    );
    assert.ok(result.reasons.includes("3 source file(s) added, removed or renamed"));
  });

  test("a new test file is not a structure change", () => {
    const result = analyze([
      file("backend-service/test/utils/newThing.test.ts", 40, 0, "added"),
    ]);
    assert.equal(result.significant, false);
    assert.equal(result.pages["Project-Structure"], undefined);
  });

  test("treats missing additions and deletions as zero", () => {
    const result = analyze([{ filename: "backend-service/src/api/project/project.ts", status: "modified" }]);
    assert.equal(result.totalChangedLines, 0);
  });

  test("handles an empty file list", () => {
    const result = analyze([]);
    assert.equal(result.significant, false);
    assert.deepEqual(result.labels, []);
  });
});

describe("isOptedOut", () => {
  test("by label", () => {
    assert.equal(isOptedOut(pr({ labels: [{ name: "skip-wiki" }] })), true);
  });
  test("by [skip wiki] in the description, any case", () => {
    assert.equal(isOptedOut(pr({ body: "Tidy up.\n\n[Skip Wiki]" })), true);
  });
  test("not otherwise, including a missing body or labels", () => {
    assert.equal(isOptedOut(pr({ body: null, labels: undefined })), false);
    assert.equal(isOptedOut(pr({ labels: [{ name: "documentation" }] })), false);
  });
});

describe("buildIssue", () => {
  const analysis = analyze([
    file("backend-service/serverless.yml", 4, 1),
    file("backend-service/src/api/project/project.ts", 60, 2),
  ]);

  test("titles the issue after the PR and labels it", () => {
    const issue = buildIssue(pr(), analysis, REPO);
    assert.equal(issue.title, "Update wiki for #42: Add a thing");
    assert.deepEqual(issue.labels, ["documentation", "backend"]);
  });

  test("truncates very long titles", () => {
    const issue = buildIssue(pr({ title: "x".repeat(300) }), analysis, REPO);
    assert.ok(issue.title.length <= 200);
    assert.ok(issue.title.endsWith("…"));
  });

  test("the body has the marker, PR link, reasons and a checklist per page", () => {
    const { body } = buildIssue(pr(), analysis, REPO);
    assert.ok(body.startsWith(marker(42)));
    assert.match(body, /\[#42\]\(https:\/\/github\.com\/acme\/kanobi\/pull\/42\)/);
    assert.match(body, /by @octocat/);
    assert.match(body, /merged on 2026-10-20/);
    assert.match(body, /Key file changed: `backend-service\/serverless.yml`/);
    assert.match(body, /- \[ \] \[API-Reference\]\(https:\/\/github\.com\/acme\/kanobi\/wiki\/API-Reference\)/);
    assert.match(body, /`backend-service\/src\/api\/project\/project.ts` \(\+60\/−2, modified\)/);
    assert.match(body, /https:\/\/github\.com\/acme\/kanobi\/pull\/42\/files/);
    assert.match(body, /git clone https:\/\/github\.com\/acme\/kanobi\.wiki\.git/);
  });

  test("lists pages alphabetically", () => {
    const { body } = buildIssue(pr(), analysis, REPO);
    const order = ["API-Reference", "Architecture", "Installation"].map((p) =>
      body.indexOf(`[${p}]`)
    );
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  test("shows a renamed file's old path", () => {
    const renamed = analyze([
      { ...file("frontend-service/src/components/New.tsx", 0, 0, "renamed"), previous_filename: "frontend-service/src/components/Was.tsx" },
    ]);
    const { body } = buildIssue(pr(), renamed, REPO);
    assert.match(body, /renamed from `frontend-service\/src\/components\/Was.tsx`/);
  });

  test("caps the file list per page", () => {
    const many = analyze(
      Array.from({ length: 20 }, (_, i) =>
        file(`frontend-service/src/components/C${i}.tsx`, 5)
      )
    );
    const { body } = buildIssue(pr(), many, REPO);
    assert.match(body, /…and 5 more/);
  });

  test("copes with a missing author and merge date", () => {
    const { body } = buildIssue(pr({ user: null, merged_at: null }), analysis, REPO);
    assert.match(body, /by @unknown/);
    assert.doesNotMatch(body, /merged on/);
  });
});

// A fake of the parts of actions/github-script's `github`, `context` and `core`
// that run() uses.
const fakes = ({
  payloadPr,
  fetchedPr = pr(),
  files = [file("backend-service/serverless.yml", 3)],
  existingIssues = [],
  env = {},
} = {}) => {
  const calls = { created: [], summaries: [], outputs: {}, infos: [] };
  const github = {
    rest: {
      pulls: {
        get: async (args) => {
          calls.getArgs = args;
          return { data: fetchedPr };
        },
        listFiles: Symbol("listFiles"),
      },
      issues: {
        listForRepo: Symbol("listForRepo"),
        create: async (args) => {
          calls.created.push(args);
          return { data: { html_url: "https://github.com/acme/kanobi/issues/7", number: 7 } };
        },
      },
    },
    paginate: async (method, args) => {
      if (method === github.rest.pulls.listFiles) {
        calls.listFilesArgs = args;
        return files;
      }
      calls.listIssuesArgs = args;
      return existingIssues;
    },
  };
  const summary = {
    addHeading: (t) => (calls.summaries.push(`# ${t}`), summary),
    addRaw: (t) => (calls.summaries.push(t), summary),
    write: async () => summary,
  };
  const core = {
    info: (m) => calls.infos.push(m),
    setOutput: (k, v) => (calls.outputs[k] = v),
    summary,
  };
  const context = { repo: REPO, payload: payloadPr ? { pull_request: payloadPr } : {} };
  return { github, core, context, env, calls };
};

describe("run", () => {
  test("opens an issue for a merged PR from the event payload", async () => {
    const f = fakes({ payloadPr: pr() });
    const result = await run(f);
    assert.equal(result.action, "created");
    assert.equal(f.calls.created.length, 1);
    assert.equal(f.calls.created[0].owner, "acme");
    assert.equal(f.calls.created[0].title, "Update wiki for #42: Add a thing");
    assert.deepEqual(f.calls.listFilesArgs, { owner: "acme", repo: "kanobi", pull_number: 42, per_page: 100 });
    assert.equal(f.calls.outputs["issue-url"], "https://github.com/acme/kanobi/issues/7");
    assert.equal(f.calls.outputs.significant, "true");
  });

  test("fetches the PR when run by hand with PR_NUMBER", async () => {
    const f = fakes({ env: { PR_NUMBER: "42" } });
    const result = await run(f);
    assert.deepEqual(f.calls.getArgs, { owner: "acme", repo: "kanobi", pull_number: 42 });
    assert.equal(result.action, "created");
  });

  test("fails clearly without a PR", async () => {
    const f = fakes();
    await assert.rejects(run(f), /No pull request/);
  });

  test("skips an unmerged PR", async () => {
    const f = fakes({ payloadPr: pr({ merged: false }) });
    const result = await run(f);
    assert.equal(result.action, "skipped");
    assert.match(result.reason, /not merged/);
    assert.equal(f.calls.created.length, 0);
  });

  test("a dry run analyses an unmerged PR and creates nothing", async () => {
    const f = fakes({ payloadPr: pr({ merged: false }), env: { DRY_RUN: "true" } });
    const result = await run(f);
    assert.equal(result.action, "dry-run");
    assert.equal(f.calls.created.length, 0);
    assert.ok(f.calls.summaries.some((s) => s.includes("Update wiki for #42")));
  });

  test("respects the opt-out", async () => {
    const f = fakes({ payloadPr: pr({ labels: [{ name: "skip-wiki" }] }) });
    const result = await run(f);
    assert.equal(result.action, "skipped");
    assert.match(result.reason, /opted out/);
  });

  test("does nothing when the change is not significant", async () => {
    const f = fakes({
      payloadPr: pr(),
      files: [file("backend-service/src/api/project/project.ts", 2)],
    });
    const result = await run(f);
    assert.equal(result.action, "skipped");
    assert.match(result.reason, /below the threshold/);
    assert.equal(f.calls.outputs.significant, "false");
    assert.equal(f.calls.created.length, 0);
  });

  test("reads the threshold from WIKI_MIN_CHANGED_LINES", async () => {
    const f = fakes({
      payloadPr: pr(),
      files: [file("backend-service/src/api/project/project.ts", 2)],
      env: { WIKI_MIN_CHANGED_LINES: "2" },
    });
    assert.equal((await run(f)).action, "created");
  });

  test("ignores a non-numeric threshold", async () => {
    const f = fakes({
      payloadPr: pr(),
      files: [file("backend-service/src/api/project/project.ts", 2)],
      env: { WIKI_MIN_CHANGED_LINES: "lots" },
    });
    assert.equal((await run(f)).action, "skipped");
  });

  test("does not open a second issue for the same PR", async () => {
    const f = fakes({
      payloadPr: pr(),
      existingIssues: [
        { body: "unrelated", html_url: "x" },
        { body: null, html_url: "y" },
        { body: `${marker(42)}\nold`, html_url: "https://github.com/acme/kanobi/issues/3" },
      ],
    });
    const result = await run(f);
    assert.equal(result.action, "exists");
    assert.equal(result.url, "https://github.com/acme/kanobi/issues/3");
    assert.equal(f.calls.created.length, 0);
    assert.deepEqual(f.calls.listIssuesArgs, {
      owner: "acme",
      repo: "kanobi",
      state: "all",
      labels: "documentation",
      creator: "github-actions[bot]",
      per_page: 100,
    });
  });

  test("does not mistake #4 for #42", async () => {
    const f = fakes({
      payloadPr: pr({ number: 4 }),
      existingIssues: [{ body: `${marker(42)}\n`, html_url: "x" }],
    });
    assert.equal((await run(f)).action, "created");
  });

  test("defaults env to process.env", async () => {
    const f = fakes({ payloadPr: pr({ merged: false }) });
    delete f.env;
    assert.equal((await run(f)).action, "skipped");
  });
});
