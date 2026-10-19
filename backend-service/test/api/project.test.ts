import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { apiEvent, context, parseBody, PROJECT_ID } from "../helpers";

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
  CreateProject,
  DeleteProject,
  GetOneProject,
  GetProjectCost,
  GetProjects,
  PutProject,
} from "../../src/api/project/project";

const ddb = mockClient(DynamoDBDocumentClient);

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
  afterEach(() => vi.unstubAllEnvs());

  describe("CreateProject", () => {
    it("saves the project and publishes PROJECT_CREATED", async () => {
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

    it("returns 500 on unexpected errors", async () => {
      ddb.on(PutCommand).rejects(new Error("db down"));
      const res = await CreateProject(apiEvent({ body: { name: "shop" } }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("GetProjects", () => {
    it("pages projects using take and nextPageToken", async () => {
      ddb.on(ScanCommand).resolves({
        Items: [{ pk: "pr_1", sk: "pr_1", name: "A", entityType: "Project" }],
        Count: 1,
        LastEvaluatedKey: { pk: "pr_1", sk: "pr_1" },
      });

      const res = await GetProjects(
        apiEvent({ queryStringParameters: { take: "5", nextPageToken: "0" } }),
        context
      );

      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toEqual({
        data: [{ id: "1", name: "A", entityType: "Project" }],
        message: "ok",
        meta: { count: 1, hasMore: true, nextPageToken: "1" },
      });
      expect(ddb.commandCalls(ScanCommand)[0].args[0].input).toEqual({
        TableName: table,
        Limit: 5,
        FilterExpression: "entityType = :type",
        ExpressionAttributeValues: { ":type": "Project" },
        ExclusiveStartKey: { pk: "pr_0", sk: "pr_0" },
      });
    });

    it("defaults paging and handles an empty table", async () => {
      ddb.on(ScanCommand).resolves({ Count: 0 });

      const res = await GetProjects(apiEvent(), context);

      expect(parseBody(res)).toEqual({
        data: [],
        message: "ok",
        meta: { count: 0, hasMore: false },
      });
      const input = ddb.commandCalls(ScanCommand)[0].args[0].input;
      expect(input.Limit).toBe(20);
      expect(input.ExclusiveStartKey).toBeUndefined();
    });

    it("treats an empty item list as no results", async () => {
      ddb.on(ScanCommand).resolves({ Items: [] });
      expect(parseBody(await GetProjects(apiEvent(), context)).data).toEqual([]);
    });

    it("returns 500 on errors", async () => {
      ddb.on(ScanCommand).rejects(new Error("x"));
      expect((await GetProjects(apiEvent(), context)).statusCode).toBe(500);
    });
  });

  describe("GetProjectCost", () => {
    const event = apiEvent({ pathParameters: { id: PROJECT_ID } });

    it("returns current and projected cost", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [{ pk: `pr_${PROJECT_ID}`, sk: `pr_${PROJECT_ID}`, entityType: "Project" }],
      });
      currentCost.mockResolvedValue({ amount: "1.00", currency: "USD" });
      monthlyCost.mockResolvedValue({ amount: "3.00", currency: "USD" });

      const res = await GetProjectCost(event, context);

      expect(parseBody(res).data).toEqual({
        currentCost: { amount: "1.00", currency: "USD" },
        projectedCost: { amount: "3.00", currency: "USD" },
      });
      expect(currentCost).toHaveBeenCalledWith("Project", PROJECT_ID);
      expect(monthlyCost).toHaveBeenCalledWith("Service", "service-555555");
      expect(ddb.commandCalls(QueryCommand)[0].args[0].input.TableName).toBe(tableEnv);
    });

    it("tolerates missing cost results", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [{ pk: "pr_1", sk: "pr_1", entityType: "Project" }],
      });
      currentCost.mockResolvedValue(undefined);
      monthlyCost.mockResolvedValue(undefined);

      expect(parseBody(await GetProjectCost(event, context)).data).toEqual({
        currentCost: {},
        projectedCost: {},
      });
    });

    it.each([[{}], [{ Items: [] }], [{ Items: [{ entityType: "Model" }] }]])(
      "returns 404 when the project is missing %#",
      async (result) => {
        ddb.on(QueryCommand).resolves(result);
        expect((await GetProjectCost(event, context)).statusCode).toBe(404);
      }
    );

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await GetProjectCost(apiEvent(), context)).statusCode).toBe(500);
    });
  });

  describe("GetOneProject", () => {
    it("returns the project with its models", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [
          { pk: "pr_1", sk: "pr_1", entityType: "Project", name: "Shop" },
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
        name: "Shop",
        models: [{ id: "2", entityType: "Model", name: "User" }],
      });
    });

    it.each([[{}], [{ Items: [] }], [{ Items: [{ entityType: "Model" }] }]])(
      "returns 404 when the project is missing %#",
      async (result) => {
        ddb.on(QueryCommand).resolves(result);
        expect((await GetOneProject(apiEvent(), context)).statusCode).toBe(404);
      }
    );

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await GetOneProject(apiEvent(), context)).statusCode).toBe(500);
    });
  });

  describe("PutProject", () => {
    it("updates name and description", async () => {
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

    it("returns 500 on errors", async () => {
      ddb.on(UpdateCommand).rejects(new Error("x"));
      const res = await PutProject(apiEvent({ body: { name: "valid" } }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("DeleteProject", () => {
    const projectItem = {
      pk: "pr_1",
      sk: "pr_1",
      entityType: "Project",
      stackName: "service-1-formation",
    };

    it("batch-deletes all project items in chunks of 25 and publishes", async () => {
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

      const res = await DeleteProject({ pathParameters: { id: "1" } });

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
      ddb.on(QueryCommand).resolves({ Items: [projectItem] });
      ddb.on(BatchWriteCommand).resolves({});
      expect((await DeleteProject({ pathParameters: { id: "1" } })).statusCode).toBe(204);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 when the project is missing %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      expect((await DeleteProject({})).statusCode).toBe(404);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await DeleteProject({})).statusCode).toBe(500);
    });
  });
});
