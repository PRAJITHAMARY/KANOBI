import {
  createServer as createHttpServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "http";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import yaml from "js-yaml";
import { initDb } from "../utils/dynamodbClient";
import { logError, logInfo, logWarning } from "../utils/logger";

// A minimal stand-in for API Gateway used by the Docker environment. It reads the
// http events from serverless.yml and calls the compiled handlers in dist/, so the
// API runs without the Serverless CLI (v4 needs a Serverless account login).

type Handler = (event: unknown, context: unknown) => Promise<HandlerResult>;

interface HandlerResult {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface Route {
  name: string;
  method: string;
  path: string;
  params: string[];
  pattern: RegExp;
  handler: Handler;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
};

export const loadRoutes = (configPath: string): Route[] => {
  const doc = yaml.load(readFileSync(configPath, "utf-8")) as any;
  const root = dirname(configPath);
  const routes: Route[] = [];

  for (const [name, fn] of Object.entries<any>(doc.functions ?? {})) {
    for (const event of fn.events ?? []) {
      if (!event.http) continue;

      const handler = loadHandler(root, fn.handler);
      if (!handler) {
        logWarning(loadRoutes.name, `Skipping ${name}: cannot load ${fn.handler}`);
        continue;
      }

      const path = "/" + event.http.path.replace(/^\//, "");
      routes.push({
        name,
        method: event.http.method.toUpperCase(),
        path,
        params: Array.from(path.matchAll(/\{(\w+)\}/g), (m) => m[1]),
        pattern: new RegExp("^" + path.replace(/\{\w+\}/g, "([^/]+)") + "/?$"),
        handler,
      });
    }
  }

  return routes;
};

const loadHandler = (root: string, handlerPath: string): Handler | undefined => {
  const dot = handlerPath.lastIndexOf(".");
  try {
    const mod = require(resolve(root, handlerPath.substring(0, dot)));
    const fn = mod[handlerPath.substring(dot + 1)];
    return typeof fn === "function" ? fn : undefined;
  } catch {
    return undefined;
  }
};

export const createServer = (routes: Route[]): Server =>
  createHttpServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      return send(res, { statusCode: 204 });
    }

    const url = new URL(req.url as string, "http://localhost");
    let route: Route | undefined;
    let values: string[] = [];
    for (const r of routes) {
      const match = r.method === req.method && r.pattern.exec(url.pathname);
      if (match) {
        route = r;
        values = match.slice(1);
        break;
      }
    }

    if (!route) {
      return send(res, {
        statusCode: 404,
        body: JSON.stringify({ message: `No route for ${req.method} ${url.pathname}` }),
      });
    }

    const body = await readBody(req);
    const event = {
      httpMethod: req.method,
      path: url.pathname,
      resource: route.path,
      headers: req.headers,
      pathParameters: route.params.length
        ? Object.fromEntries(
            route.params.map((p, i) => [p, decodeURIComponent(values[i])])
          )
        : null,
      queryStringParameters: url.searchParams.size
        ? Object.fromEntries(url.searchParams)
        : null,
      body: body || null,
    };

    try {
      send(res, await route.handler(event, {}));
    } catch (error) {
      logError(route.name, error);
      send(res, {
        statusCode: 500,
        body: JSON.stringify({ message: "Internal server error" }),
      });
    }
  });

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });

const send = (res: ServerResponse, result: HandlerResult) => {
  res.writeHead(result.statusCode ?? 200, { ...CORS_HEADERS, ...result.headers });
  res.end(result.body ?? "");
};

export const resolvePort = () => Number(process.env.PORT ?? 3000);

export const start = async (
  configPath = resolve(__dirname, "..", "..", "serverless.yml"),
  port = resolvePort()
) => {
  await initDb(process.env.SERVICE_TABLE ?? "");

  const routes = loadRoutes(configPath);
  for (const route of routes) {
    logInfo(start.name, `${route.method} ${route.path} -> ${route.name}`);
  }

  const server = createServer(routes);
  await new Promise<void>((done) => server.listen(port, done));
  logInfo(start.name, `Kanobi API listening on port ${port}`);

  return server;
};
