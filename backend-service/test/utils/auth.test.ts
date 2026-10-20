import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  authErrorResponse,
  getUserId,
  ProjectNotFoundError,
  requireProjectOwner,
  UnauthorizedError,
} from "../../src/utils/auth";
import { apiEvent, parseBody, USER_ID } from "../helpers";

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddb.reset());
afterEach(() => vi.unstubAllEnvs());

describe("getUserId", () => {
  it("returns the token's sub", () => {
    expect(getUserId(apiEvent())).toBe(USER_ID);
    expect(getUserId(apiEvent({ userId: "someone" }))).toBe("someone");
  });

  it.each([
    ["no claims", apiEvent({ userId: null })],
    ["no request context", { ...apiEvent(), requestContext: undefined }],
    ["an empty sub", apiEvent({ userId: "" })],
    [
      "a non-string sub",
      { ...apiEvent(), requestContext: { authorizer: { claims: { sub: 42 } } } },
    ],
  ])("throws UnauthorizedError for %s", (_case, event) => {
    expect(() => getUserId(event as any)).toThrow(UnauthorizedError);
  });
});

describe.each([
  ["KanobiTable", "KanobiTable"],
  [undefined, ""],
])("requireProjectOwner (SERVICE_TABLE=%s)", (tableEnv, table) => {
  beforeEach(() => vi.stubEnv("SERVICE_TABLE", tableEnv));

  it("returns the project row for its owner", async () => {
    const row = { pk: "pr_p1", sk: "pr_p1", ownerId: USER_ID, name: "shop" };
    ddb.on(GetCommand).resolves({ Item: row });

    await expect(requireProjectOwner("p1", USER_ID)).resolves.toEqual(row);
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toEqual({
      TableName: table,
      Key: { pk: "pr_p1", sk: "pr_p1" },
    });
  });

  it.each([
    ["a missing project", undefined],
    ["another user's project", { pk: "pr_p1", sk: "pr_p1", ownerId: "someone-else" }],
    ["a project without an owner", { pk: "pr_p1", sk: "pr_p1" }],
  ])("reports %s as not found", async (_case, Item) => {
    ddb.on(GetCommand).resolves({ Item });
    await expect(requireProjectOwner("p1", USER_ID)).rejects.toThrow(
      new ProjectNotFoundError("p1")
    );
  });
});

describe("authErrorResponse", () => {
  it("maps UnauthorizedError to 401", () => {
    const res = authErrorResponse(new UnauthorizedError())!;
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toEqual({ message: "Unauthorized" });
  });

  it("maps ProjectNotFoundError to 404", () => {
    const res = authErrorResponse(new ProjectNotFoundError("p1"))!;
    expect(res.statusCode).toBe(404);
    expect(parseBody(res)).toEqual({ message: "Project with id: p1 Not found" });
  });

  it("ignores other errors", () => {
    expect(authErrorResponse(new Error("boom"))).toBeUndefined();
  });
});
