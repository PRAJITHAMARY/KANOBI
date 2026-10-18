import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { streamOf } from "../helpers";

const s3 = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  listFolder: vi.fn(),
  uploadFile: vi.fn(),
}));
const local = vi.hoisted(() => ({ startLocalBuild: vi.fn() }));
const codebuild = vi.hoisted(() => ({ startBuild: vi.fn(), options: [] as unknown[] }));
const zip = vi.hoisted(() => ({
  fail: false,
  dirs: [] as string[],
  closed: Promise.resolve() as Promise<unknown>,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
vi.mock("../../src/utils/S3Client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...s3,
}));
vi.mock("../../src/utils/localBuildRunner", () => local);
vi.mock("aws-sdk", () => ({
  CodeBuild: class {
    constructor(options: unknown) {
      codebuild.options.push(options);
    }
    startBuild = codebuild.startBuild;
  },
}));
// Stand-in for archiver: "zips" by writing a marker into the output stream.
vi.mock("archiver", () => ({
  default: () => {
    const handlers: Record<string, (err: Error) => void> = {};
    let output: NodeJS.WritableStream;
    return {
      on: (event: string, cb: (err: Error) => void) => (handlers[event] = cb),
      pipe: (out: NodeJS.WritableStream) => (output = out),
      directory: (dir: string) => zip.dirs.push(dir),
      pointer: () => 3,
      finalize: () => {
        zip.closed = new Promise((resolve) => output.on("close", resolve));
        if (!zip.fail) return output.end("zip");
        // Fail once the file is open, then close it so teardown can delete it.
        output.once("open", () => {
          handlers.error(new Error("zip failed"));
          output.end();
        });
      },
    };
  },
}));

import { deploymentTriggeredHandler } from "../../src/api/deployment/deploymentEvent";

const ddb = mockClient(DynamoDBDocumentClient);

const payload = {
  projectId: "p1",
  projectName: "Shop",
  model: { id: "d1" } as any,
};

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(join(tmpdir(), "kanobi-deploy-"));
  vi.spyOn(process, "cwd").mockReturnValue(workDir);
  vi.stubEnv("NODE_ENV", "dev");

  ddb.reset();
  ddb.on(UpdateCommand).resolves({});
  Object.values(s3).forEach((fn) => fn.mockReset());
  s3.uploadFile.mockResolvedValue({ ETag: "e" });
  codebuild.startBuild.mockReset();
  codebuild.options.length = 0;
  local.startLocalBuild.mockReset();
  zip.fail = false;
  zip.dirs.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5 });
});

const givenRemoteFiles = (files: Record<string, string | null>, extra: object[] = []) => {
  s3.listFolder.mockResolvedValue([...Object.keys(files).map((Key) => ({ Key })), ...extra]);
  s3.downloadFile.mockImplementation(async (key: string) =>
    files[key] === null ? null : streamOf(files[key] as string)
  );
};

describe("deploymentTriggeredHandler", () => {
  it("downloads, zips, uploads and starts a CodeBuild deploy", async () => {
    givenRemoteFiles(
      {
        "p1/serverless.yml": "service: x",
        "p1/src/index.ts": "export {}",
        "p1/src/utils/a.ts": "a",
        "p1/src/utils/b.ts": "b",
        "p1/missing.txt": null,
      },
      [{}]
    );
    codebuild.startBuild.mockReturnValue({
      promise: () =>
        Promise.resolve({
          build: { id: "b1", buildStatus: "IN_PROGRESS", currentPhase: "QUEUED", buildComplete: false },
        }),
    });

    await deploymentTriggeredHandler(payload);

    const downloads = join(workDir, ".downloads");
    expect(fs.readFileSync(join(downloads, "p1", "src", "utils", "b.ts"), "utf-8")).toBe("b");
    expect(fs.existsSync(join(downloads, "p1", "missing.txt"))).toBe(true);
    expect(zip.dirs).toEqual([join(downloads, "p1")]);
    expect(s3.uploadFile).toHaveBeenCalledWith("p1.zip", Buffer.from("zip"));

    expect(codebuild.options).toEqual([
      {
        region: "eu-west-1",
        credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
      },
    ]);
    const build = codebuild.startBuild.mock.calls[0][0];
    expect(build).toMatchObject({
      projectName: "sls-code-deploy",
      sourceTypeOverride: "S3",
      sourceLocationOverride: "kanobi-bucket/p1.zip",
    });
    expect(build.buildspecOverride).toContain("node ./docs.js -p Shop");
    expect(build.buildspecOverride).toContain(
      "aws s3 cp ./dist/swagger-json.json s3://kanobi-bucket/p1/swagger-json.json"
    );

    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
      TableName: "KanobiTable",
      Key: { pk: "pr_p1", sk: "dp_d1" },
      ExpressionAttributeValues: {
        ":isDeploying": true,
        ":buildStatus": "IN_PROGRESS",
        ":buildId": "b1",
        ":currentPhase": "QUEUED",
        ":buildComplete": false,
      },
    });
  });

  it("builds locally from a clean copy when targeting LocalStack", async () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    const projectDir = join(workDir, ".downloads", "p1");
    fs.mkdirSync(join(projectDir, "node_modules"), { recursive: true });
    fs.writeFileSync(join(projectDir, "stale.ts"), "old");
    givenRemoteFiles({ "p1/serverless.yml": "service: x" });
    local.startLocalBuild.mockResolvedValue({
      build: { id: "local:1", buildStatus: "IN_PROGRESS", currentPhase: "INSTALL", buildComplete: false },
    });

    await deploymentTriggeredHandler(payload);

    expect(fs.existsSync(join(projectDir, "stale.ts"))).toBe(false);
    expect(fs.existsSync(join(projectDir, "node_modules"))).toBe(false);
    expect(fs.readFileSync(join(projectDir, "serverless.yml"), "utf-8")).toBe("service: x");
    expect(local.startLocalBuild).toHaveBeenCalledWith(projectDir, "p1", "Shop");
    expect(codebuild.startBuild).not.toHaveBeenCalled();
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues).toMatchObject({
      ":isDeploying": true,
      ":buildId": "local:1",
      ":buildStatus": "IN_PROGRESS",
      ":currentPhase": "INSTALL",
      ":buildComplete": false,
    });
  });

  it("reuses an existing download directory and tolerates a missing build", async () => {
    vi.stubEnv("SERVICE_TABLE", undefined);
    fs.mkdirSync(join(workDir, ".downloads"));
    givenRemoteFiles({ "p1/a.txt": "a" });
    codebuild.startBuild.mockReturnValue({ promise: () => Promise.resolve({}) });

    await deploymentTriggeredHandler(payload);

    const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.TableName).toBe("");
    expect(update.ExpressionAttributeValues).toMatchObject({
      ":buildId": undefined,
      ":isDeploying": true,
    });
  });

  it("downloads to /tmp outside dev", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(fs.existsSync).mockReturnValueOnce(true);
    s3.listFolder.mockRejectedValue(new Error("stop here"));

    await expect(deploymentTriggeredHandler(payload)).rejects.toThrow("stop here");
    expect(fs.existsSync).toHaveBeenCalledWith(join("/tmp", ".downloads"));
  });

  it("rejects without a project id", async () => {
    await expect(
      deploymentTriggeredHandler({ ...payload, projectId: undefined })
    ).rejects.toBe("invalid project folder");
  });

  it("rejects when a file cannot be written", async () => {
    // "p1/dir" is created as a directory first, so writing it as a file fails.
    givenRemoteFiles({ "p1/dir/file.txt": "x", "p1/dir": "y" });

    await expect(deploymentTriggeredHandler(payload)).rejects.toThrow();
    expect(s3.uploadFile).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("rejects when zipping fails", async () => {
    givenRemoteFiles({});
    zip.fail = true;
    await expect(deploymentTriggeredHandler(payload)).rejects.toThrow("zip failed");
    await zip.closed;
  });

  it("rejects when the zip upload fails", async () => {
    givenRemoteFiles({});
    s3.uploadFile.mockResolvedValue(undefined);
    await expect(deploymentTriggeredHandler(payload)).rejects.toBe("Failed to upload Zip");
    expect(codebuild.startBuild).not.toHaveBeenCalled();
  });
});
