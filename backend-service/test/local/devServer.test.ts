import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import { AddressInfo } from "net";
import { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";

const db = vi.hoisted(() => ({ initDb: vi.fn() }));
vi.mock("../../src/utils/dynamodbClient", () => db);
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { loadRoutes, resolvePort, start } from "../../src/local/devServer";

const HANDLERS = `
exports.echo = async (event) => ({
  statusCode: 201,
  headers: { "X-Handler": "echo" },
  body: JSON.stringify(event),
});
exports.bare = async () => ({});
exports.boom = async () => { throw new Error("boom"); };
exports.notAFunction = 1;
`;

const CONFIG = `
functions:
  Echo:
    handler: handlers.echo
    events:
      - http:
          method: get
          path: /item/{projectId}/{modelId}
      - http:
          method: post
          path: item
  Bare:
    handler: handlers.bare
    events:
      - http:
          method: DELETE
          path: /bare
  Boom:
    handler: handlers.boom
    events:
      - http:
          method: get
          path: /boom
  Worker:
    handler: handlers.echo
    events:
      - schedule: rate(1 minute)
  NoEvents:
    handler: handlers.echo
  Missing:
    handler: dist/nope.handler
    events:
      - http:
          method: get
          path: /missing
  NotFn:
    handler: handlers.notAFunction
    events:
      - http:
          method: get
          path: /not-fn
`;

let dir: string;
let server: Server | undefined;

const writeConfig = (config: string) => {
  const path = join(dir, "serverless.yml");
  fs.writeFileSync(path, config);
  return path;
};

const listen = async () => {
  server = await start(writeConfig(CONFIG), 0);
  return `http://localhost:${(server.address() as AddressInfo).port}`;
};

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "kanobi-dev-server-"));
  fs.writeFileSync(join(dir, "handlers.js"), HANDLERS);
  db.initDb.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadRoutes", () => {
  it("registers http events and skips other and unloadable functions", () => {
    const routes = loadRoutes(writeConfig(CONFIG));

    expect(routes.map((r) => [r.name, r.method, r.path, r.params])).toEqual([
      ["Echo", "GET", "/item/{projectId}/{modelId}", ["projectId", "modelId"]],
      ["Echo", "POST", "/item", []],
      ["Bare", "DELETE", "/bare", []],
      ["Boom", "GET", "/boom", []],
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "LOADROUTES",
      "Skipping Missing: cannot load dist/nope.handler"
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "LOADROUTES",
      "Skipping NotFn: cannot load handlers.notAFunction"
    );
  });

  it("returns no routes when there are no functions", () => {
    expect(loadRoutes(writeConfig("service: empty\n"))).toEqual([]);
  });
});

describe("dev server", () => {
  it("initialises the table and logs each route on start", async () => {
    vi.stubEnv("SERVICE_TABLE", "KanobiTable");
    await listen();

    expect(db.initDb).toHaveBeenCalledWith("KanobiTable");
    expect(console.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "START",
      "GET /item/{projectId}/{modelId} -> Echo"
    );
  });

  it("passes an empty table name to initDb when SERVICE_TABLE is unset", async () => {
    vi.stubEnv("SERVICE_TABLE", undefined);
    await listen();
    expect(db.initDb).toHaveBeenCalledWith("");
  });

  it("maps path params, query string, headers and body into the event", async () => {
    const base = await listen();

    const res = await fetch(`${base}/item/p%201/m1/?take=5&q=a`, {
      headers: { "X-Custom": "yes" },
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("x-handler")).toBe("echo");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const event = await res.json();
    expect(event).toMatchObject({
      httpMethod: "GET",
      path: "/item/p%201/m1/",
      resource: "/item/{projectId}/{modelId}",
      pathParameters: { projectId: "p 1", modelId: "m1" },
      queryStringParameters: { take: "5", q: "a" },
      body: null,
    });
    expect(event.headers["x-custom"]).toBe("yes");
  });

  it("passes the request body and null params for static routes", async () => {
    const base = await listen();

    const res = await fetch(`${base}/item`, {
      method: "POST",
      body: JSON.stringify({ name: "Shop" }),
    });

    expect(await res.json()).toMatchObject({
      httpMethod: "POST",
      pathParameters: null,
      queryStringParameters: null,
      body: '{"name":"Shop"}',
    });
  });

  it("defaults to 200 with an empty body", async () => {
    const base = await listen();
    const res = await fetch(`${base}/bare`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("answers CORS preflight requests", async () => {
    const base = await listen();
    const res = await fetch(`${base}/item`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe(
      "OPTIONS,POST,GET,PUT,DELETE"
    );
  });

  it.each([
    ["an unknown path", "GET", "/nowhere"],
    ["a known path with another method", "PUT", "/item"],
  ])("returns 404 for %s", async (_label, method, path) => {
    const base = await listen();
    const res = await fetch(base + path, { method });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: `No route for ${method} ${path}` });
  });

  it("returns 500 when a handler throws", async () => {
    const base = await listen();
    const res = await fetch(`${base}/boom`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal server error" });
    expect(console.error).toHaveBeenCalled();
  });

  it("loads the package's serverless.yml by default", async () => {
    vi.stubEnv("PORT", "0");
    vi.mocked(fs.readFileSync).mockReturnValueOnce("service: kanobi");

    server = await start();

    expect(fs.readFileSync).toHaveBeenCalledWith(
      join(__dirname, "..", "..", "serverless.yml"),
      "utf-8"
    );
    expect(server.listening).toBe(true);
  });
});

describe("resolvePort", () => {
  it("reads PORT and falls back to 3000", () => {
    vi.stubEnv("PORT", "4000");
    expect(resolvePort()).toBe(4000);
    vi.stubEnv("PORT", undefined);
    expect(resolvePort()).toBe(3000);
  });
});
