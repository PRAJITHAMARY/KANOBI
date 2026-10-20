import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { apiEvent, context, parseBody, PROJECT_ID, USER_ID } from "../helpers";

const { publish, currentCost, monthlyCost } = vi.hoisted(() => ({
  publish: vi.fn(),
  currentCost: vi.fn(),
  monthlyCost: vi.fn(),
}));

vi.mock("uuid", () => ({ v4: () => "new-id" }));
vi.mock("../../src/utils/eventhub", () => ({
  EventHub: { Get: () => ({ publish }) },
}));
vi.mock("../../src/utils/infraHelper", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getStackCurrentCost: currentCost,
  getStackMonthlyCost: monthlyCost,
}));

import {
  COST_CACHE_MS,
  CreateProject,
  DeleteProject,
  GetOneProject,
  GetProjectCost,
  GetProjects,
  PutProject,
} from "../../src/api/project/project";

const ddb = mockClient(DynamoDBDocumentClient);

/** The project row requireProjectOwner loads; owned by USER_ID unless overridden. */
const projectRow = (id: string, extra: Record<string, unknown> = {}) => ({
  pk: `pr_${id}`,
  sk: `pr_${id}`,
  entityType: "Project",
  name: "shop",
  ownerId: USER_ID,
  ...extra,
});

const givenOwnedProject = (id: string, extra: Record<string, unknown> = {}) =>
  ddb.on(GetCommand).resolves({ Item: projectRow(id, extra) });

beforeEach(() => {
  ddb.reset();
  publish.mockReset().mockResolvedValue(true);
  currentCost.mockReset();
  monthlyCost.mockReset();
});

// Handlers fall back to "" when SERVICE_TABLE is unset; run everything both ways.
describe.each([
  ["KanobiTable", "KanobiTable"],
  [undefined, ""],
])("project handlers (SERVICE_TABLE=%s)", (tableEnv, table) => {
  beforeEach(() => {
    vi.stubEnv("SERVICE_TABLE", tableEnv);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe("CreateProject", () => {
    it("saves the project with its owner and publishes PROJECT_CREATED", async () => {
      ddb.on(PutCommand).resolves({});

      const res = await CreateProject(
        apiEvent({ body: { name: "shop", description: "d" } }),
        context
      );

      expect(res.statusCode).toBe(201);
      expect(parseBody(res).data).toEqual({ id: "new-id", name: "shop", description: "d" });
      expect(ddb.commandCalls(PutCommand)[0].args[0].input).toEqual({
        TableName: table,
        Item: {
          pk: "pr_new-id",
          sk: "pr_new-id",
          entityType: "Project",
          ownerId: USER_ID,
          name: "shop",
          description: "d",
        },
      });
      expect(publish).toHaveBeenCalledWith({
        type: "project created",
        payload: { id: "new-id", name: "shop", description: "d" },
      });
    });

    it("rejects an invalid or missing body", async () => {
      const res = await CreateProject(apiEvent(), context);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).data[0].path).toEqual(["name"]);
      expect(ddb.calls()).toHaveLength(0);
    });

    it.each(["x; rm -rf /", "$(whoami)", "My Shop", "shop\nphases:"])(
      "rejects the unsafe name %j with a readable message",
      async (name) => {
        const res = await CreateProject(apiEvent({ body: { name } }), context);
        expect(res.statusCode).toBe(400);
        expect(parseBody(res).message).toBe(
          "name: Project name can only contain lowercase letters, numbers and hyphens"
        );
        expect(ddb.calls()).toHaveLength(0);
        expect(publish).not.toHaveBeenCalled();
      }
    );

    it("returns 401 without a signed-in user", async () => {
      const res = await CreateProject(
        apiEvent({ body: { name: "shop" }, userId: null }),
        context
      );
      expect(res.statusCode).toBe(401);
      expect(ddb.calls()).toHaveLength(0);
    });

    it("returns 500 on unexpected errors", async () => {
      ddb.on(PutCommand).rejects(new Error("db down"));
      const res = await CreateProject(apiEvent({ body: { name: "shop" } }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("GetProjects", () => {
    it("lists only the user's projects, paging with take and nextPageToken", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [projectRow("1", { name: "a" })],
        Count: 1,
        LastEvaluatedKey: { ownerId: USER_ID, pk: "pr_1", sk: "pr_1" },
      });

      const res = await GetProjects(
        apiEvent({ queryStringParameters: { take: "5", nextPageToken: "0" } }),
        context
      );

      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toEqual({
        data: [{ id: "1", name: "a", entityType: "Project" }],
        message: "ok",
        meta: { count: 1, hasMore: true, nextPageToken: "1" },
      });
      expect(ddb.commandCalls(QueryCommand)[0].args[0].input).toEqual({
        TableName: table,
        IndexName: "byOwner",
        KeyConditionExpression: "ownerId = :ownerId",
        ExpressionAttributeValues: { ":ownerId": USER_ID },
        Limit: 5,
        ExclusiveStartKey: { ownerId: USER_ID, pk: "pr_0", sk: "pr_0" },
      });
    });

    it("defaults paging and handles no results", async () => {
      ddb.on(QueryCommand).resolves({ Count: 0 });

      const res = await GetProjects(apiEvent(), context);

      expect(parseBody(res)).toEqual({
        data: [],
        message: "ok",
        meta: { count: 0, hasMore: false },
      });
      const input = ddb.commandCalls(QueryCommand)[0].args[0].input;
      expect(input.Limit).toBe(20);
      expect(input.ExclusiveStartKey).toBeUndefined();
    });

    it("leaves cached cost out of the response", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [projectRow("1", { cost: { fetchedAt: "x" } })],
      });
      expect(parseBody(await GetProjects(apiEvent(), context)).data).toEqual([
        { id: "1", name: "shop", entityType: "Project" },
      ]);
    });

    it("returns 401 without a signed-in user", async () => {
      expect((await GetProjects(apiEvent({ userId: null }), context)).statusCode).toBe(401);
      expect(ddb.calls()).toHaveLength(0);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await GetProjects(apiEvent(), context)).statusCode).toBe(500);
    });
  });

  describe("GetProjectCost", () => {
    const event = apiEvent({ pathParameters: { id: PROJECT_ID } });
    const NOW = new Date("2026-10-19T12:00:00.000Z");
    const freshCost = {
      currentCost: { amount: "1.00", currency: "USD" },
      projectedCost: { amount: "3.00", currency: "USD" },
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    it("fetches current and projected cost and caches it on the project", async () => {
      givenOwnedProject(PROJECT_ID);
      ddb.on(UpdateCommand).resolves({});
      currentCost.mockResolvedValue({ amount: "1.00", currency: "USD" });
      monthlyCost.mockResolvedValue({ amount: "3.00", currency: "USD" });

      const res = await GetProjectCost(event, context);

      expect(parseBody(res).data).toEqual(freshCost);
      expect(currentCost).toHaveBeenCalledWith("Project", PROJECT_ID);
      expect(monthlyCost).toHaveBeenCalledWith("Service", "service-555555");
      expect(ddb.commandCalls(UpdateCommand)[0].args[0].input).toEqual({
        TableName: table,
        Key: { pk: `pr_${PROJECT_ID}`, sk: `pr_${PROJECT_ID}` },
        UpdateExpression: "set #cost = :cost",
        ExpressionAttributeNames: { "#cost": "cost" },
        ExpressionAttributeValues: {
          ":cost": { ...freshCost, fetchedAt: NOW.toISOString() },
        },
      });
    });

    it("serves a cached cost younger than an hour without calling Cost Explorer", async () => {
      const fetchedAt = new Date(NOW.getTime() - COST_CACHE_MS + 1000).toISOString();
      givenOwnedProject(PROJECT_ID, { cost: { ...freshCost, fetchedAt } });

      const res = await GetProjectCost(event, context);

      expect(parseBody(res).data).toEqual(freshCost);
      expect(currentCost).not.toHaveBeenCalled();
      expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("refreshes a cached cost an hour old", async () => {
      const fetchedAt = new Date(NOW.getTime() - COST_CACHE_MS).toISOString();
      givenOwnedProject(PROJECT_ID, { cost: { ...freshCost, fetchedAt } });
      ddb.on(UpdateCommand).resolves({});
      currentCost.mockResolvedValue({ amount: "2.00", currency: "USD" });
      monthlyCost.mockResolvedValue({ amount: "4.00", currency: "USD" });

      const res = await GetProjectCost(event, context);

      expect(parseBody(res).data.currentCost.amount).toBe("2.00");
      expect(currentCost).toHaveBeenCalled();
    });

    it("tolerates missing cost results", async () => {
      givenOwnedProject(PROJECT_ID);
      ddb.on(UpdateCommand).resolves({});
      currentCost.mockResolvedValue(undefined);
      monthlyCost.mockResolvedValue(undefined);

      expect(parseBody(await GetProjectCost(event, context)).data).toEqual({
        currentCost: {},
        projectedCost: {},
      });
    });

    it.each([
      ["missing", undefined],
      ["owned by someone else", projectRow(PROJECT_ID, { ownerId: "other" })],
    ])("returns 404 when the project is %s", async (_case, Item) => {
      ddb.on(GetCommand).resolves({ Item });
      expect((await GetProjectCost(event, context)).statusCode).toBe(404);
      expect(currentCost).not.toHaveBeenCalled();
    });

    it("returns 401 without a signed-in user", async () => {
      const res = await GetProjectCost(
        apiEvent({ pathParameters: { id: PROJECT_ID }, userId: null }),
        context
      );
      expect(res.statusCode).toBe(401);
    });

    it("returns 500 on errors", async () => {
      ddb.on(GetCommand).rejects(new Error("x"));
      expect((await GetProjectCost(apiEvent(), context)).statusCode).toBe(500);
    });
  });

  describe("GetOneProject", () => {
    it("returns the project with its models", async () => {
      givenOwnedProject("1");
      ddb.on(QueryCommand).resolves({
        Items: [
          projectRow("1", { cost: { fetchedAt: "x" } }),
          { pk: "pr_1", sk: "ml_2", entityType: "Model", name: "User" },
          { pk: "pr_1", sk: "dp_3", entityType: "Deployment" },
        ],
      });

      const res = await GetOneProject(
        apiEvent({ pathParameters: { id: "1" } }),
        context
      );

      expect(parseBody(res).data).toEqual({
        id: "1",
        entityType: "Project",
        name: "shop",
        models: [{ id: "2", entityType: "Model", name: "User" }],
      });
      expect(ddb.commandCalls(QueryCommand)[0].args[0].input.TableName).toBe(tableEnv);
    });

    it("returns 404 for another user's project without reading it", async () => {
      ddb.on(GetCommand).resolves({ Item: projectRow("1", { ownerId: "other" }) });
      const res = await GetOneProject(apiEvent({ pathParameters: { id: "1" } }), context);
      expect(res.statusCode).toBe(404);
      expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
    });

    it.each([[{}], [{ Items: [] }], [{ Items: [{ entityType: "Model" }] }]])(
      "returns 404 when the project rows are missing %#",
      async (result) => {
        givenOwnedProject("1");
        ddb.on(QueryCommand).resolves(result);
        expect(
          (await GetOneProject(apiEvent({ pathParameters: { id: "1" } }), context)).statusCode
        ).toBe(404);
      }
    );

    it("returns 401 without a signed-in user", async () => {
      expect((await GetOneProject(apiEvent({ userId: null }), context)).statusCode).toBe(401);
    });

    it("returns 500 on errors", async () => {
      givenOwnedProject("1");
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await GetOneProject(apiEvent(), context)).statusCode).toBe(500);
    });
  });

  describe("PutProject", () => {
    it("updates name and description of an owned project", async () => {
      givenOwnedProject("1");
      ddb.on(UpdateCommand).resolves({});

      const res = await PutProject(
        apiEvent({ pathParameters: { id: "1" }, body: { name: "new-name" } }),
        context
      );

      expect(parseBody(res).data).toEqual({ id: "1", name: "new-name" });
      expect(ddb.commandCalls(UpdateCommand)[0].args[0].input).toEqual({
        TableName: table,
        Key: { pk: "pr_1", sk: "pr_1" },
        UpdateExpression: "set #name = :name",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":name": "new-name" },
      });
    });

    it.each([
      ["an unknown project", undefined],
      ["another user's project", projectRow("1", { ownerId: "other" })],
    ])("returns 404 and writes nothing for %s", async (_case, Item) => {
      ddb.on(GetCommand).resolves({ Item });
      const res = await PutProject(
        apiEvent({ pathParameters: { id: "1" }, body: { name: "new-name" } }),
        context
      );
      expect(res.statusCode).toBe(404);
      expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("rejects an invalid body", async () => {
      const res = await PutProject(apiEvent({ body: { name: "x" } }), context);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toBe(
        "name: Project name must be at least 3 characters"
      );
      const unsafe = await PutProject(
        apiEvent({ pathParameters: { id: "1" }, body: { name: "a; curl evil" } }),
        context
      );
      expect(unsafe.statusCode).toBe(400);
      expect(ddb.calls()).toHaveLength(0);
      expect((await PutProject(apiEvent(), context)).statusCode).toBe(400);
    });

    it("returns 401 without a signed-in user", async () => {
      const res = await PutProject(
        apiEvent({ pathParameters: { id: "1" }, body: { name: "valid" }, userId: null }),
        context
      );
      expect(res.statusCode).toBe(401);
      expect(ddb.calls()).toHaveLength(0);
    });

    it("returns 500 on errors", async () => {
      givenOwnedProject("1");
      ddb.on(UpdateCommand).rejects(new Error("x"));
      const res = await PutProject(apiEvent({ body: { name: "valid" } }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("DeleteProject", () => {
    const projectItem = projectRow("1", { stackName: "service-1-formation" });
    const deleteEvent = apiEvent({ pathParameters: { id: "1" } });

    it("batch-deletes all project items in chunks of 25 and publishes", async () => {
      givenOwnedProject("1");
      const models = Array.from({ length: 26 }, (_, i) => ({
        pk: "pr_1",
        sk: `ml_${i}`,
        entityType: "Model",
      }));
      ddb.on(QueryCommand).resolves({ Items: [projectItem, ...models] });
      ddb
        .on(BatchWriteCommand)
        .resolvesOnce({ UnprocessedItems: { [table]: [] } })
        .resolvesOnce({ UnprocessedItems: {} });

      const res = await DeleteProject(deleteEvent);

      expect(res.statusCode).toBe(204);
      const batches = ddb.commandCalls(BatchWriteCommand);
      expect(batches).toHaveLength(2);
      expect(batches[0].args[0].input.RequestItems?.[table]).toHaveLength(25);
      // 27 items: the project row plus 26 models
      expect(batches[1].args[0].input.RequestItems?.[table]).toEqual([
        { DeleteRequest: { Key: { pk: "pr_1", sk: "ml_24" } } },
        { DeleteRequest: { Key: { pk: "pr_1", sk: "ml_25" } } },
      ]);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith({
        type: "project deleted",
        payload: { id: "1", stackName: "service-1-formation" },
      });
    });

    it("does not warn when the batch response omits UnprocessedItems", async () => {
      givenOwnedProject("1");
      ddb.on(QueryCommand).resolves({ Items: [projectItem] });
      ddb.on(BatchWriteCommand).resolves({});
      expect((await DeleteProject(deleteEvent)).statusCode).toBe(204);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it("returns 404 and deletes nothing for another user's project", async () => {
      ddb.on(GetCommand).resolves({ Item: projectRow("1", { ownerId: "other" }) });
      expect((await DeleteProject(deleteEvent)).statusCode).toBe(404);
      expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(0);
      expect(publish).not.toHaveBeenCalled();
    });

    it.each([[{}], [{ Items: [] }]])(
      "returns 404 when the project rows are missing %#",
      async (result) => {
        givenOwnedProject("1");
        ddb.on(QueryCommand).resolves(result);
        expect((await DeleteProject(deleteEvent)).statusCode).toBe(404);
      }
    );

    it("returns 401 without a signed-in user", async () => {
      expect((await DeleteProject(apiEvent({ userId: null }))).statusCode).toBe(401);
      expect(ddb.calls()).toHaveLength(0);
    });

    it("returns 500 on errors", async () => {
      givenOwnedProject("1");
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await DeleteProject(deleteEvent)).statusCode).toBe(500);
    });
  });
});
