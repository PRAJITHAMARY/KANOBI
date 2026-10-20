import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import {
  copyFolder,
  deleteFolder,
  downloadFile,
  emptyBucket,
  getSource,
  listFolder,
  readStreamToBuffer,
  streamToString,
  uploadFile,
} from "../../src/utils/S3Client";
import { streamOf } from "../helpers";

const s3 = mockClient(S3Client);

beforeEach(() => s3.reset());

describe("uploadFile", () => {
  it("puts the object in the configured bucket", async () => {
    s3.on(PutObjectCommand).resolves({ ETag: "e" });
    expect(await uploadFile("k", "body")).toEqual({ ETag: "e" });
    expect(s3.commandCalls(PutObjectCommand)[0].args[0].input).toEqual({
      Bucket: "kanobi-bucket",
      Key: "k",
      Body: "body",
    });
  });

  it("logs and returns undefined on error", async () => {
    s3.on(PutObjectCommand).rejects(new Error("x"));
    expect(await uploadFile("k", "body")).toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("downloadFile", () => {
  it("returns the object body", async () => {
    const body = streamOf("data");
    s3.on(GetObjectCommand).resolves({ Body: body as any });
    expect(await downloadFile("k")).toBe(body);
  });

  it("returns null on error", async () => {
    s3.on(GetObjectCommand).rejects(new Error("x"));
    expect(await downloadFile("k")).toBeNull();
  });
});

describe("listFolder", () => {
  it("normalises the prefix and follows continuation tokens", async () => {
    s3.on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [{ Key: "p/a" }],
        IsTruncated: true,
        NextContinuationToken: "t",
      })
      .resolvesOnce({ IsTruncated: false });

    expect(await listFolder("p")).toEqual([{ Key: "p/a" }]);
    const calls = s3.commandCalls(ListObjectsV2Command);
    expect(calls[0].args[0].input).toEqual({
      Bucket: "kanobi-bucket",
      Prefix: "p/",
      ContinuationToken: undefined,
    });
    expect(calls[1].args[0].input.ContinuationToken).toBe("t");
  });

  it("keeps an already normalised prefix", async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [] });
    await listFolder("p/");
    expect(s3.commandCalls(ListObjectsV2Command)[0].args[0].input.Prefix).toBe("p/");
  });

  it("returns an empty list on error", async () => {
    s3.on(ListObjectsV2Command).rejects(new Error("x"));
    expect(await listFolder("p")).toEqual([]);
  });
});

describe("deleteFolder", () => {
  it("does nothing for an empty folder", async () => {
    s3.on(ListObjectsV2Command).resolves({});
    await deleteFolder("p");
    expect(s3.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });

  it("deletes the objects and the deployment zip", async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: "p/a" }, { Key: "p/b" }] });
    await deleteFolder("p");

    const calls = s3.commandCalls(DeleteObjectsCommand);
    expect(s3.commandCalls(ListObjectsV2Command)[0].args[0].input.Prefix).toBe("p/");
    expect(calls[0].args[0].input.Delete).toEqual({
      Objects: [{ Key: "p/a" }, { Key: "p/b" }],
    });
    expect(calls[1].args[0].input.Delete).toEqual({ Objects: [{ Key: "p.zip" }] });
  });

  it("derives the zip key from a prefix with a trailing slash", async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: "proj/a" }] });
    await deleteFolder("proj/");

    const calls = s3.commandCalls(DeleteObjectsCommand);
    expect(s3.commandCalls(ListObjectsV2Command)[0].args[0].input.Prefix).toBe("proj/");
    // Documents current behaviour: the last character of the folder name is dropped.
    expect(calls[1].args[0].input.Delete).toEqual({ Objects: [{ Key: "pro.zip" }] });
  });

  it("logs errors", async () => {
    s3.on(ListObjectsV2Command).rejects(new Error("x"));
    await expect(deleteFolder("p")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("copyFolder", () => {
  it("copies every object to the new prefix", async () => {
    s3.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "boilerplate/a.ts" }, {}, { Key: "boilerplate/src/b.ts" }],
    });

    expect(await copyFolder("boilerplate/", "p1")).toEqual(["p1/a.ts", "p1/src/b.ts"]);
    expect(s3.commandCalls(CopyObjectCommand)[0].args[0].input).toEqual({
      Bucket: "kanobi-bucket",
      CopySource: "kanobi-bucket/boilerplate/a.ts",
      Key: "p1/a.ts",
    });
  });

  it("normalises a source prefix without a trailing slash", async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: "from/x" }] });
    expect(await copyFolder("from", "to/")).toEqual(["to/x"]);
  });

  it("returns an empty list on error", async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: "from/x" }] });
    s3.on(CopyObjectCommand).rejects(new Error("x"));
    expect(await copyFolder("from", "to")).toEqual([]);
  });
});

describe("streamToString", () => {
  it("returns an empty string for a null stream", async () => {
    expect(await streamToString(null)).toBe("");
  });

  it("concatenates buffer chunks", async () => {
    const stream = new Readable({ read() {} });
    const promise = streamToString(stream);
    stream.push(Buffer.from("ab"));
    stream.push(Buffer.from("cd"));
    stream.push(null);
    expect(await promise).toBe("abcd");
  });

  it("accepts string chunks from an encoded stream", async () => {
    const stream = Readable.from([Buffer.from("héllo")]).setEncoding("utf-8");
    expect(await streamToString(stream)).toBe("héllo");
  });

  it("rejects on stream error", async () => {
    const stream = new Readable({ read() {} });
    const promise = streamToString(stream);
    stream.destroy(new Error("bad"));
    await expect(promise).rejects.toThrow("bad");
  });
});

describe("getSource", () => {
  it("parses the downloaded file into a ts-morph source file", async () => {
    s3.on(GetObjectCommand).resolves({
      Body: streamOf("export const x = 1;") as any,
    });
    const source = await getSource("p/src/index.ts");
    expect(source.getVariableDeclarationOrThrow("x").getInitializer()?.getText()).toBe("1");
  });
});

describe("readStreamToBuffer", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kanobi-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a file into a buffer", async () => {
    const file = join(dir, "f.txt");
    writeFileSync(file, "content");
    expect((await readStreamToBuffer(file)).toString()).toBe("content");
  });

  it("rejects for a missing file", async () => {
    await expect(readStreamToBuffer(join(dir, "missing"))).rejects.toThrow();
  });
});

describe("emptyBucket", () => {
  it("deletes versions and delete markers page by page", async () => {
    s3.on(ListObjectVersionsCommand)
      .resolvesOnce({
        Versions: [{ Key: "a", VersionId: "1" }],
        DeleteMarkers: [{ Key: "b", VersionId: "2" }],
        IsTruncated: true,
        NextKeyMarker: "km",
        NextVersionIdMarker: "vm",
      })
      .resolvesOnce({ Versions: [{ Key: "c", VersionId: "3" }] })

    await emptyBucket("bucket");

    const lists = s3.commandCalls(ListObjectVersionsCommand);
    expect(lists).toHaveLength(2);
    expect(lists[1].args[0].input).toEqual({
      Bucket: "bucket",
      KeyMarker: "km",
      VersionIdMarker: "vm",
    });
    const deletes = s3.commandCalls(DeleteObjectsCommand);
    expect(deletes[0].args[0].input).toEqual({
      Bucket: "bucket",
      Delete: {
        Objects: [
          { Key: "a", VersionId: "1" },
          { Key: "b", VersionId: "2" },
        ],
        Quiet: true,
      },
    });
    expect(deletes[1].args[0].input.Delete?.Objects).toEqual([
      { Key: "c", VersionId: "3" },
    ]);
  });

  it("skips the delete call for an empty bucket", async () => {
    s3.on(ListObjectVersionsCommand).resolves({ IsTruncated: false });
    await emptyBucket("bucket");
    expect(s3.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });
});

describe("client configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the local S3 endpoint in dev", async () => {
    vi.stubEnv("NODE_ENV", "dev");
    vi.resetModules();
    const mod = await import("../../src/utils/S3Client");
    s3.on(PutObjectCommand).resolves({});
    await mod.uploadFile("k", "b");
    const client = s3.commandCalls(PutObjectCommand)[0].thisValue as S3Client;
    expect(await client.config.endpoint?.()).toMatchObject({ hostname: "localhost" });
    expect(await client.config.credentials()).toMatchObject({
      accessKeyId: "test",
      secretAccessKey: "test",
    });
  });

  it("uses the default credential chain (the Lambda role) outside dev", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AWS_KEY", "static-key");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "role-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "role-secret");
    vi.resetModules();
    const mod = await import("../../src/utils/S3Client");
    s3.on(PutObjectCommand).resolves({});
    await mod.uploadFile("k", "b");
    const client = s3.commandCalls(PutObjectCommand)[0].thisValue as S3Client;
    expect(client.config.endpoint).toBeUndefined();
    expect(await client.config.credentials()).toMatchObject({ accessKeyId: "role-key" });
  });
});
