import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { streamOf } from "../helpers";

type Outcome = number | "error" | "hang";

const proc = vi.hoisted(() => ({
  spawn: vi.fn(),
  // Exit code (or behaviour) per spawned command, keyed by "<command> <first arg>".
  outcomes: {} as Record<string, Outcome>,
  hanging: [] as { emit: (event: string, ...args: unknown[]) => void }[],
}));
const s3 = vi.hoisted(() => ({ uploadFile: vi.fn(), downloadFile: vi.fn() }));

vi.mock("child_process", () => ({ spawn: proc.spawn }));
vi.mock("../../src/utils/S3Client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...s3,
}));

import {
  getLocalBuild,
  patchServerlessYml,
  startLocalBuild,
} from "../../src/utils/localBuildRunner";

let dir: string;

const fakeChild = (command: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  const outcome = proc.outcomes[`${command} ${args[0]}`] ?? 0;

  if (outcome === "hang") {
    proc.hanging.push(child);
    return child;
  }

  setImmediate(() => {
    if (outcome === "error") return child.emit("error", new Error(`spawn ${command} ENOENT`));
    child.stdout.emit("data", Buffer.from(`out:${command}\n`));
    child.stderr.emit("data", `err:${command}\n`);
    child.emit("close", outcome);
  });
  return child;
};

const stateUploads = () =>
  s3.uploadFile.mock.calls
    .filter(([key]) => String(key).startsWith("builds/"))
    .map(([key, body]) => ({ key, ...JSON.parse(body) }));

const finalState = () => stateUploads().at(-1);

const spawned = () =>
  proc.spawn.mock.calls.map(([command, args]) => [command, ...args].join(" "));

const writeYaml = (doc: object) =>
  fs.writeFileSync(join(dir, "serverless.yml"), yaml.dump(doc));

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "kanobi-build-"));
  fs.mkdirSync(join(dir, "dist"));
  fs.writeFileSync(join(dir, "dist", "swagger-json.json"), '{"openapi":"3.0.0"}');
  writeYaml({ service: "svc", functions: null });

  vi.stubEnv("AWS_ENDPOINT", "http://localstack:4566");
  proc.spawn.mockReset().mockImplementation(fakeChild);
  proc.outcomes = {};
  proc.hanging = [];
  s3.uploadFile.mockReset().mockResolvedValue({ ETag: "e" });
  s3.downloadFile.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("startLocalBuild", () => {
  it("returns an in-progress build straight away and saves it", async () => {
    proc.outcomes["npm install"] = "hang";

    const { build, done } = await startLocalBuild(dir, "p1", "Shop");

    expect(build).toEqual({
      id: expect.stringMatching(/^local:[0-9a-f-]{36}$/),
      buildStatus: "IN_PROGRESS",
      currentPhase: "INSTALL",
      buildComplete: false,
    });
    expect(stateUploads()[0]).toMatchObject({
      key: `builds/${build.id}.json`,
      build,
      logs: "",
    });

    await vi.waitFor(() => expect(proc.hanging).toHaveLength(1));
    proc.hanging[0].emit("close", 1);
    await done;
  });

  it("runs the buildspec steps, uploads the swagger and deploys to LocalStack", async () => {
    // Left over from the old configuration; must never reach the build.
    vi.stubEnv("AWS_KEY", "leaked-key");
    vi.stubEnv("AWS_SECRET", "leaked-secret");
    const { build, done } = await startLocalBuild(dir, "p1", "x; rm -rf /");
    await done;

    expect(spawned()).toEqual([
      "npm install",
      "npm install --save-dev serverless-localstack @types/node",
      "npm run build",
      "node ./docs.js -p x; rm -rf /",
      "sls deploy --stage prod",
    ]);
    // The project name reaches docs.js as a single argument, never through a shell.
    expect(proc.spawn.mock.calls[3][1]).toEqual(["./docs.js", "-p", "x; rm -rf /"]);

    const [, , options] = proc.spawn.mock.calls[0];
    expect(options.cwd).toBe(dir);
    expect(options.env).toMatchObject({
      // LocalStack accepts any credentials.
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_REGION: "eu-west-1",
      NODE_ENV: "test",
    });
    expect(proc.spawn.mock.calls[4][2].env.NODE_ENV).toBe("production");

    expect(s3.uploadFile).toHaveBeenCalledWith(
      "p1/swagger-json.json",
      Buffer.from('{"openapi":"3.0.0"}')
    );

    const final = finalState();
    expect(final.key).toBe(`builds/${build.id}.json`);
    expect(final.build).toEqual({
      id: build.id,
      buildStatus: "SUCCEEDED",
      currentPhase: "COMPLETED",
      buildComplete: true,
    });
    expect(final.logs).toContain("$ npm run build\nout:npm\nerr:npm\n");
    expect(final.logs).toContain("$ sls deploy --stage prod\nout:sls\n");
    expect(stateUploads().map((s) => s.build.currentPhase)).toEqual([
      "INSTALL",
      "INSTALL",
      "INSTALL",
      "BUILD",
      "BUILD",
      "POST_BUILD",
      "COMPLETED",
    ]);

    const patched = yaml.load(fs.readFileSync(join(dir, "serverless.yml"), "utf-8"));
    expect(patched).toMatchObject({ plugins: ["serverless-localstack"] });
  });

  it("fails the build and stops when a step exits non-zero", async () => {
    proc.outcomes["npm run"] = 2;

    const { done } = await startLocalBuild(dir, "p1", "Shop");
    await done;

    expect(spawned()).toEqual([
      "npm install",
      "npm install --save-dev serverless-localstack @types/node",
      "npm run build",
    ]);
    expect(finalState().build).toMatchObject({
      buildStatus: "FAILED",
      currentPhase: "COMPLETED",
      buildComplete: true,
    });
    expect(finalState().logs).toContain("Error: npm exited with code 2");
    expect(s3.uploadFile).not.toHaveBeenCalledWith("p1/swagger-json.json", expect.anything());
  });

  it("fails the build when a command cannot be started", async () => {
    proc.outcomes["sls deploy"] = "error";

    const { done } = await startLocalBuild(dir, "p1", "Shop");
    await done;

    expect(finalState().build.buildStatus).toBe("FAILED");
    expect(finalState().logs).toContain("Error: spawn sls ENOENT");
  });

  it("fails the build before deploying when the swagger upload fails", async () => {
    s3.uploadFile.mockImplementation(async (key: string) =>
      key.endsWith("swagger-json.json") ? undefined : { ETag: "e" }
    );

    const { done } = await startLocalBuild(dir, "p1", "Shop");
    await done;

    expect(spawned()).not.toContain("sls deploy --stage prod");
    expect(finalState().build.buildStatus).toBe("FAILED");
    expect(finalState().logs).toContain("Failed to upload swagger-json.json");
  });

  it("fails the build when the project has no serverless.yml", async () => {
    fs.rmSync(join(dir, "serverless.yml"));

    const { done } = await startLocalBuild(dir, "p1", "Shop");
    await done;

    expect(proc.spawn).not.toHaveBeenCalled();
    expect(finalState().build.buildStatus).toBe("FAILED");
    expect(finalState().logs).toContain("ENOENT");
  });

  it("flushes progress periodically while a step runs", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    proc.outcomes["npm install"] = "hang";

    const { done } = await startLocalBuild(dir, "p1", "Shop");
    await vi.waitFor(() => expect(proc.hanging).toHaveLength(1));
    const before = stateUploads().length;

    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => expect(stateUploads().length).toBe(before + 1));
    expect(finalState().build.buildStatus).toBe("IN_PROGRESS");

    proc.hanging[0].emit("close", 1);
    await done;
    expect(finalState().build.buildStatus).toBe("FAILED");
  });
});

describe("patchServerlessYml", () => {
  it("adds the LocalStack plugin once and keeps existing plugins and custom config", () => {
    vi.stubEnv("AWS_ENDPOINT", undefined);
    writeYaml({
      plugins: ["serverless-localstack", "other"],
      custom: { keep: true },
    });

    patchServerlessYml(dir);

    expect(yaml.load(fs.readFileSync(join(dir, "serverless.yml"), "utf-8"))).toEqual({
      plugins: ["serverless-localstack", "other"],
      custom: {
        keep: true,
        localstack: {
          stages: ["prod"],
          host: "http://localhost",
          edgePort: "4566",
          autostart: false,
        },
      },
    });
  });

  it("derives host and port from AWS_ENDPOINT", () => {
    patchServerlessYml(dir);

    const doc = yaml.load(fs.readFileSync(join(dir, "serverless.yml"), "utf-8")) as any;
    expect(doc.custom.localstack).toMatchObject({
      host: "http://localstack",
      edgePort: "4566",
    });
  });
});

describe("getLocalBuild", () => {
  it("returns a placeholder when the build state is missing", async () => {
    s3.downloadFile.mockResolvedValue(null);
    expect(await getLocalBuild("local:1")).toEqual({ build: null, logs: "No logs found" });
    expect(s3.downloadFile).toHaveBeenCalledWith("builds/local:1.json");
  });

  it("returns the saved build and logs", async () => {
    const build = { id: "local:1", buildStatus: "SUCCEEDED", buildComplete: true };
    s3.downloadFile.mockResolvedValue(streamOf(JSON.stringify({ build, logs: "done" })));
    expect(await getLocalBuild("local:1")).toEqual({ build, logs: "done" });
  });
});
