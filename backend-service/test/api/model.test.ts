import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { apiEvent, context, parseBody, PROJECT_ID } from "../helpers";

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("uuid", () => ({ v4: () => "new-model" }));
vi.mock("../../src/utils/eventhub", () => ({
  EventHub: { Get: () => ({ publish }) },
}));

import {
  CreateModel,
  CreateModelRelations,
  DeleteModel,
  DeleteModelRelations,
  GetModels,
  GetOneModel,
  PutModel,
  PutModelAPI,
} from "../../src/api/model/model";

const ddb = mockClient(DynamoDBDocumentClient);

const PK = `pr_${PROJECT_ID}`;
const ids = { projectId: PROJECT_ID, modelId: "m1" };

const modelItem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  pk: PK,
  sk: `ml_${id}`,
  entityType: "Model",
  name,
  description: "",
  properties: [],
  apis: [],
  ...extra,
});

/** Resolve QueryCommand by the requested sort key (or by pk alone). */
const queryBySk = (bySk: Record<string, unknown[] | undefined>) => {
  ddb.on(QueryCommand).callsFake((input) => {
    const sk = input.ExpressionAttributeValues?.[":sk"];
    return { Items: bySk[sk] };
  });
};

const missingIdCases = [
  ["projectId", { modelId: "m1" }, "Project Id must be valid"],
  ["modelId", { projectId: PROJECT_ID }, "Model Id must be valid"],
] as const;

beforeEach(() => {
  ddb.reset();
  publish.mockReset().mockResolvedValue(true);
});

describe.each([
  ["KanobiTable", "KanobiTable"],
  [undefined, ""],
])("model handlers (SERVICE_TABLE=%s)", (tableEnv, table) => {
  beforeEach(() => {
    vi.stubEnv("SERVICE_TABLE", tableEnv);
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("CreateModel", () => {
    const body = {
      name: "User",
      properties: [{ name: "email", type: "string", required: true }],
    };

    it("saves the model with every API enabled and publishes MODEL_CREATED", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [
          { pk: PK, sk: PK, entityType: "Project", name: "User" },
          modelItem("m0", "Post"),
        ],
      });
      // The handler mutates the item after sending it, so snapshot it at send time.
      let saved: any;
      ddb.on(PutCommand).callsFake((input) => {
        saved = structuredClone(input);
        return {};
      });

      const res = await CreateModel(
        apiEvent({ body, pathParameters: { projectId: PROJECT_ID } }),
        context
      );

      expect(res.statusCode).toBe(201);
      expect(saved.TableName).toBe(table);
      expect(saved.Item).toMatchObject({
        pk: PK,
        sk: "ml_new-model",
        entityType: "Model",
        name: "User",
        description: "",
      });
      expect(saved.Item?.apis.map((a: { method: string }) => a.method)).toEqual([
        "getone",
        "get",
        "post",
        "put",
        "delete",
        "postmultiple",
        "deletemultiple",
      ]);
      expect(parseBody(res).data).toMatchObject({ id: "new-model", name: "User" });
      expect(publish).toHaveBeenCalledWith({
        type: "model created",
        payload: {
          projectId: PROJECT_ID,
          model: expect.objectContaining({ id: "new-model", name: "User" }),
        },
      });
    });

    it("rejects a model name that already exists", async () => {
      ddb.on(QueryCommand).resolves({ Items: [modelItem("m0", "User")] });
      const res = await CreateModel(
        apiEvent({ body, pathParameters: { projectId: PROJECT_ID } }),
        context
      );
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).data).toBe("Model already exists in project");
    });

    it("rejects duplicate property names", async () => {
      const res = await CreateModel(
        apiEvent({
          body: {
            name: "User",
            properties: [
              { name: "a", type: "string", required: true },
              { name: "a", type: "number", required: false },
            ],
          },
        }),
        context
      );
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).data[0].message).toBe(
        "Duplicate property names are not allowed."
      );
    });

    it("rejects a missing body", async () => {
      expect((await CreateModel(apiEvent(), context)).statusCode).toBe(400);
    });

    it("requires a project id", async () => {
      const res = await CreateModel(apiEvent({ body }), context);
      expect(parseBody(res).data).toBe("Project Id must be valid");
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 for an unknown project %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      const res = await CreateModel(
        apiEvent({ body, pathParameters: { projectId: "x" } }),
        context
      );
      expect(res.statusCode).toBe(404);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      const res = await CreateModel(
        apiEvent({ body, pathParameters: { projectId: "x" } }),
        context
      );
      expect(res.statusCode).toBe(500);
    });
  });

  describe("GetModels", () => {
    it("lists the project's models", async () => {
      ddb.on(QueryCommand).resolves({ Items: [modelItem("m1", "User")], Count: 1 });

      const res = await GetModels(
        apiEvent({ pathParameters: { projectId: PROJECT_ID } }),
        context
      );

      expect(parseBody(res)).toMatchObject({
        data: [{ id: "m1", name: "User" }],
        meta: { count: 1 },
      });
      expect(ddb.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
        TableName: table,
        ExpressionAttributeValues: { ":type": "Model", ":pk": PK },
      });
    });

    it.each([[{}], [{ Items: [] }]])("returns an empty list %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      const res = await GetModels(apiEvent({ pathParameters: { projectId: "p" } }), context);
      expect(parseBody(res).data).toEqual([]);
    });

    it("requires a project id", async () => {
      expect((await GetModels(apiEvent(), context)).statusCode).toBe(400);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      const res = await GetModels(apiEvent({ pathParameters: { projectId: "p" } }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("GetOneModel", () => {
    it("returns the model", async () => {
      ddb.on(QueryCommand).resolves({ Items: [modelItem("m1", "User")] });
      const res = await GetOneModel(apiEvent({ pathParameters: ids }), context);
      expect(parseBody(res).data).toMatchObject({ id: "m1", name: "User" });
      expect(ddb.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues).toEqual({
        ":pk": PK,
        ":sk": "ml_m1",
      });
    });

    it.each(missingIdCases)("requires %s", async (_n, pathParameters, message) => {
      const res = await GetOneModel(apiEvent({ pathParameters }), context);
      expect(parseBody(res).data).toBe(message);
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 when missing %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      expect((await GetOneModel(apiEvent({ pathParameters: ids }), context)).statusCode).toBe(404);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await GetOneModel(apiEvent({ pathParameters: ids }), context)).statusCode).toBe(500);
    });
  });

  describe.each([
    [
      "PutModel",
      PutModel,
      { name: "User", properties: [{ name: "a", type: "string", required: true }] },
      { name: "x" },
    ],
    [
      "PutModelAPI",
      PutModelAPI,
      { apis: [{ method: "get", generate: false }] },
      { apis: [{ method: "patch", generate: true }] },
    ],
  ])("%s", (_name, handler, validBody, invalidBody) => {
    it("updates the model and publishes MODEL_UPDATED", async () => {
      const stored = modelItem("m1", "User");
      ddb.on(UpdateCommand).resolves({});
      ddb.on(QueryCommand).resolves({ Items: [stored] });

      const res = await handler(apiEvent({ pathParameters: ids, body: validBody }), context);

      expect(res.statusCode).toBe(200);
      expect(parseBody(res).data).toMatchObject({ id: "m1" });
      const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.TableName).toBe(table);
      expect(update.Key).toEqual({ pk: PK, sk: "ml_m1" });
      expect(update.ExpressionAttributeValues).toMatchObject(
        Object.fromEntries(
          Object.entries(validBody).map(([k, v]) => [`:${k}`, v])
        )
      );
      expect(publish).toHaveBeenCalledWith({
        type: "model updated",
        payload: { models: [stored], projectId: PROJECT_ID },
      });
    });

    it.each(missingIdCases)("requires %s", async (_n, pathParameters, message) => {
      const res = await handler(apiEvent({ pathParameters, body: validBody }), context);
      expect(parseBody(res).data).toBe(message);
    });

    it("rejects an invalid body", async () => {
      const res = await handler(apiEvent({ pathParameters: ids, body: invalidBody }), context);
      expect(res.statusCode).toBe(400);
      expect((await handler(apiEvent({ pathParameters: ids }), context)).statusCode).toBe(400);
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 when missing %#", async (result) => {
      ddb.on(UpdateCommand).resolves({});
      ddb.on(QueryCommand).resolves(result);
      const res = await handler(apiEvent({ pathParameters: ids, body: validBody }), context);
      expect(res.statusCode).toBe(404);
      expect(publish).not.toHaveBeenCalled();
    });

    it("returns 500 on errors", async () => {
      ddb.on(UpdateCommand).rejects(new Error("x"));
      const res = await handler(apiEvent({ pathParameters: ids, body: validBody }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("CreateModelRelations", () => {
    const body = {
      relations: [
        { modelId: "m2", relationship: "one-to-many" },
        { modelId: "m3", relationship: "many-to-many" },
        { modelId: "gone", relationship: "one-to-one" },
        { modelId: "empty", relationship: "one-to-one" },
      ],
    };

    it("links both sides of each relation and publishes every involved model", async () => {
      queryBySk({
        ml_m1: [modelItem("m1", "User")],
        // m2 has no relations yet; m3 already points back at m1 and at another model
        ml_m2: [modelItem("m2", "Post")],
        ml_m3: [
          modelItem("m3", "Group", {
            relations: [
              { modelId: "m1", relationship: "old" },
              { modelId: "m9", relationship: "one-to-one" },
            ],
          }),
        ],
        ml_gone: undefined,
        ml_empty: [],
      });
      ddb.on(UpdateCommand).resolves({});

      const res = await CreateModelRelations(apiEvent({ pathParameters: ids, body }), context);

      expect(res.statusCode).toBe(200);
      expect(parseBody(res).data).toEqual({
        id: "m1",
        entityType: "Model",
        name: "User",
        description: "",
        properties: [],
        apis: [],
        relations: [
          { modelId: "m2", mainModel: "User", relatedModel: "Post", relationship: "one-to-many" },
          { modelId: "m3", mainModel: "User", relatedModel: "Group", relationship: "many-to-many" },
        ],
      });

      const updates = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
      expect(updates.map((u) => u.Key?.sk)).toEqual(["ml_m2", "ml_m3", "ml_m1"]);
      expect(updates.every((u) => u.TableName === table)).toBe(true);
      expect(updates[0].ExpressionAttributeValues?.[":relations"]).toEqual([
        {
          modelId: "m1",
          mainModel: "Post",
          relatedModel: "User",
          relationship: "many-to-one",
          tableName: "usersTable555555",
        },
      ]);
      expect(
        updates[1].ExpressionAttributeValues?.[":relations"].map(
          (r: { modelId: string; relationship: string }) => [r.modelId, r.relationship]
        )
      ).toEqual([
        ["m9", "one-to-one"],
        ["m1", "many-to-many"],
      ]);

      const payload = publish.mock.calls[0][0].payload;
      expect(payload.projectId).toBe(PROJECT_ID);
      expect(payload.models.map((m: { name: string }) => m.name)).toEqual([
        "Post",
        "Group",
        "User",
      ]);
      // The published main model keeps its keys and table names.
      expect(payload.models[2]).toMatchObject({ pk: PK, sk: "ml_m1" });
      expect(payload.models[2].relations[0].tableName).toBe("postsTable555555");
    });

    it.each(missingIdCases)("requires %s", async (_n, pathParameters, message) => {
      const res = await CreateModelRelations(apiEvent({ pathParameters, body }), context);
      expect(parseBody(res).data).toBe(message);
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 for an unknown model %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      const res = await CreateModelRelations(apiEvent({ pathParameters: ids, body }), context);
      expect(res.statusCode).toBe(404);
    });

    it("rejects an invalid body", async () => {
      queryBySk({ ml_m1: [modelItem("m1", "User")] });
      const res = await CreateModelRelations(
        apiEvent({ pathParameters: ids, body: { relations: [{ modelId: "m2", relationship: "x" }] } }),
        context
      );
      expect(res.statusCode).toBe(400);
      expect(
        (await CreateModelRelations(apiEvent({ pathParameters: ids }), context)).statusCode
      ).toBe(400);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      const res = await CreateModelRelations(apiEvent({ pathParameters: ids, body }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("DeleteModelRelations", () => {
    const body = {
      relations: [
        { modelId: "m2", relationship: "one-to-many" },
        { modelId: "m3", relationship: "one-to-one" },
        { modelId: "m4", relationship: "one-to-one" },
        { modelId: "gone", relationship: "one-to-one" },
        { modelId: "empty", relationship: "one-to-one" },
      ],
    };

    it("unlinks both sides and publishes the changed models", async () => {
      queryBySk({
        ml_m1: [
          modelItem("m1", "User", {
            relations: [
              { modelId: "m2", relationship: "one-to-many" },
              { modelId: "m5", relationship: "one-to-one" },
            ],
          }),
        ],
        ml_m2: [
          modelItem("m2", "Post", {
            relations: [
              { modelId: "m1", relationship: "many-to-one" },
              { modelId: "m7", relationship: "one-to-one" },
            ],
          }),
        ],
        // m3 has no relations; m4 has relations but none to m1
        ml_m3: [modelItem("m3", "Tag")],
        ml_m4: [modelItem("m4", "Note", { relations: [{ modelId: "m8" }] })],
        ml_gone: undefined,
        ml_empty: [],
      });
      ddb.on(UpdateCommand).resolves({});

      const res = await DeleteModelRelations(apiEvent({ pathParameters: ids, body }), context);

      expect(parseBody(res).data.relations).toEqual([
        { modelId: "m5", relationship: "one-to-one" },
      ]);
      const updates = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
      expect(updates.map((u) => u.Key?.sk)).toEqual(["ml_m2", "ml_m1"]);
      expect(updates.every((u) => u.TableName === table)).toBe(true);
      expect(updates[0].ExpressionAttributeValues?.[":relations"]).toEqual([
        { modelId: "m7", relationship: "one-to-one" },
      ]);
      expect(
        publish.mock.calls[0][0].payload.models.map((m: { name: string }) => m.name)
      ).toEqual(["Post", "User"]);
    });

    it("handles a main model without relations", async () => {
      queryBySk({ ml_m1: [modelItem("m1", "User")] });
      ddb.on(UpdateCommand).resolves({});
      const res = await DeleteModelRelations(
        apiEvent({ pathParameters: ids, body: { relations: [] } }),
        context
      );
      expect(parseBody(res).data.relations).toEqual([]);
    });

    it.each(missingIdCases)("requires %s", async (_n, pathParameters, message) => {
      const res = await DeleteModelRelations(apiEvent({ pathParameters, body }), context);
      expect(parseBody(res).data).toBe(message);
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 for an unknown model %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      const res = await DeleteModelRelations(apiEvent({ pathParameters: ids, body }), context);
      expect(res.statusCode).toBe(404);
    });

    it("rejects an invalid body", async () => {
      queryBySk({ ml_m1: [modelItem("m1", "User")] });
      const res = await DeleteModelRelations(apiEvent({ pathParameters: ids }), context);
      expect(res.statusCode).toBe(400);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      const res = await DeleteModelRelations(apiEvent({ pathParameters: ids, body }), context);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("DeleteModel", () => {
    it("deletes the model, updates related models and publishes MODEL_DELETED", async () => {
      queryBySk({
        ml_m1: [
          modelItem("m1", "User", {
            relations: [
              { modelId: "m2" },
              { modelId: "m3" },
              { modelId: "m4" },
              { modelId: "gone" },
              { modelId: "empty" },
            ],
          }),
        ],
        ml_m2: [modelItem("m2", "Post", { relations: [{ modelId: "m1" }, { modelId: "m6" }] })],
        ml_m3: [modelItem("m3", "Tag")],
        ml_m4: [modelItem("m4", "Note", { relations: [{ modelId: "m8" }] })],
        ml_gone: undefined,
        ml_empty: [],
      });
      ddb.on(UpdateCommand).resolves({});
      ddb.on(DeleteCommand).resolves({});

      const res = await DeleteModel({ pathParameters: ids });

      expect(res.statusCode).toBe(204);
      const updates = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
      // Documents current behaviour: the update targets the deleted model itself.
      expect(updates).toHaveLength(2);
      expect(updates.every((u) => u.Key?.sk === "ml_m1" && u.TableName === table)).toBe(true);
      expect(updates[0].ExpressionAttributeValues?.[":relations"]).toEqual([{ modelId: "m6" }]);
      expect(ddb.commandCalls(DeleteCommand)[0].args[0].input).toEqual({
        TableName: table,
        Key: { pk: PK, sk: "ml_m1" },
      });
      expect(publish).toHaveBeenCalledWith({
        type: "model deleted",
        payload: {
          model: expect.objectContaining({ id: "m1", name: "User" }),
          projectId: PROJECT_ID,
        },
      });
    });

    it("deletes a model without relations", async () => {
      queryBySk({ ml_m1: [modelItem("m1", "User")] });
      ddb.on(DeleteCommand).resolves({});
      expect((await DeleteModel({ pathParameters: ids })).statusCode).toBe(204);
      expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it.each(missingIdCases)("requires %s", async (_n, pathParameters, message) => {
      expect(parseBody(await DeleteModel({ pathParameters })).data).toBe(message);
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 when missing %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      expect((await DeleteModel({ pathParameters: ids })).statusCode).toBe(404);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await DeleteModel({ pathParameters: ids })).statusCode).toBe(500);
    });
  });
});
