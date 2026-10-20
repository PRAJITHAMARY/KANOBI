import { readFileSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { Project } from "ts-morph";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";

export const context = {} as Context;

export const USER_ID = "user-1";

export const apiEvent = (
  overrides: {
    body?: unknown;
    pathParameters?: Record<string, string | undefined> | null;
    queryStringParameters?: Record<string, string | undefined> | null;
    /** The signed-in user's `sub`; null for a request without claims. */
    userId?: string | null;
  } = {}
) =>
  ({
    requestContext:
      overrides.userId === null
        ? {}
        : { authorizer: { claims: { sub: overrides.userId ?? USER_ID } } },
    body:
      overrides.body === undefined
        ? null
        : typeof overrides.body === "string"
        ? overrides.body
        : JSON.stringify(overrides.body),
    pathParameters: overrides.pathParameters ?? null,
    queryStringParameters: overrides.queryStringParameters ?? null,
  } as unknown as APIGatewayProxyEvent);

export const parseBody = (response: { body?: string }) =>
  JSON.parse(response.body as string);

export const streamOf = (text: string) => Readable.from([Buffer.from(text)]);

export const indexTemplateText = readFileSync(
  join(__dirname, "..", "boilerplate", "src", "indexTemplate.ts"),
  "utf-8"
);

export const boilerplateYaml = readFileSync(
  join(__dirname, "..", "boilerplate", "serverless.yml"),
  "utf-8"
);

export const sourceFileOf = (path: string, text: string) =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile(path, text, {
    overwrite: true,
  });

// 36 chars, like the uuid project ids used in production.
export const PROJECT_ID = "11111111-2222-3333-4444-555555555555";
