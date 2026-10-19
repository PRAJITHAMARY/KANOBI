import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { apiEvent, context, parseBody, streamOf } from "../helpers";

const { publish, fetchBuildLogs, fetchApiGatewayDetails, downloadFile } = vi.hoisted(
  () => ({
    publish: vi.fn(),
    fetchBuildLogs: vi.fn(),
    fetchApiGatewayDetails: vi.fn(),
    downloadFile: vi.fn(),
  })
);

vi.mock("uuid", () => ({ v4: () => "dep-id" }));
vi.mock("../../src/utils/eventhub", () => ({
  EventHub: { Get: () => ({ publish }) },
}));
vi.mock("../../src/utils/infraHelper", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FetchBuildLogs: fetchBuildLogs,
  fetchApiGatewayDetails,
}));
vi.mock("../../src/utils/S3Client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadFile,
}));

import { GetDeployment, TriggerDeployment } from "../../src/api/deployment/deployment";

const ddb = mockClient(DynamoDBDocumentClient);

const project = {
  pk: "pr_p1",
  sk: "pr_p1",
  entityType: "Project",
  name: "shop",
  description: "desc",
  stackName: "service-1-formation",
};

const deploymentItem = (extra: Record<string, unknown> = {}) => ({
  pk: "pr_p1",
  sk: "dp_d1",
  entityType: "Deployment",
  triggeredAt: "2026-01-01T00:00:00.000Z",
  isDeploying: true,
  ...extra,
});

const swagger = () =>
  streamOf(JSON.stringify({ info: { title: "t" }, paths: {} }));

beforeEach(() => {
  ddb.reset();
  publish.mockReset().mockResolvedValue(true);
  fetchBuildLogs.mockReset();
  fetchApiGatewayDetails.mockReset();
  downloadFile.mockReset();
});

describe.each([
  ["KanobiTable", "KanobiTable"],
  [undefined, ""],
])("deployment handlers (SERVICE_TABLE=%s)", (tableEnv, table) => {
  beforeEach(() => {
    vi.stubEnv("SERVICE_TABLE", tableEnv);
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("GetDeployment", () => {
    const event = apiEvent({ pathParameters: { projectId: "p1" } });

    it("records a newly succeeded build and attaches swagger docs", async () => {
      const deployment = deploymentItem({
        buildId: "b1",
        buildStatus: "IN_PROGRESS",
        deployedAt: "2026-01-02T00:00:00.000Z",
      });
      ddb.on(QueryCommand).resolves({ Items: [project, deployment] });
      ddb.on(UpdateCommand).resolves({});
      fetchBuildLogs.mockResolvedValue({
        build: { id: "b1", buildComplete: true, buildStatus: "SUCCEEDED", currentPhase: "COMPLETED" },
        logs: "log text",
      });
      fetchApiGatewayDetails.mockResolvedValue({ apiId: "api1", baseUrl: "https://api" });

      const res = await GetDeployment(event, context);

      expect(fetchBuildLogs).toHaveBeenCalledWith("b1");
      expect(fetchApiGatewayDetails).toHaveBeenCalledWith("service-1-formation", "prod");
      const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.TableName).toBe(table);
      expect(update.Key).toEqual({ pk: "pr_p1", sk: "dp_d1" });
      expect(update.ExpressionAttributeValues).toEqual({
        ":triggeredAt": "2026-01-01T00:00:00.000Z",
        ":isDeploying": false,
        ":buildStatus": "SUCCEEDED",
        ":buildId": "b1",
        ":currentPhase": "COMPLETED",
        ":buildComplete": true,
        ":baseUrl": "https://api",
        ":apiId": "api1",
      });

      const data = parseBody(res).data;
      expect(data).toMatchObject({
        id: "d1",
        projectId: "p1",
        isDeploying: true,
        triggeredAt: "2026-01-01T00:00:00.000Z",
        deployedAt: "2026-01-02T00:00:00.000Z",
        buildComplete: true,
        buildStatus: "SUCCEEDED",
        currentPhase: "COMPLETED",
        log: "log text",
        apiId: "api1",
        baseUrl: "https://api",
      });
      // apiId was not yet stored on the deployment, so no swagger yet
      expect(data.swaggerJson).toBeUndefined();
    });

    it("stores empty endpoint details for a failed build", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [{ ...project, stackName: undefined }, deploymentItem({ buildId: "b1" })],
      });
      ddb.on(UpdateCommand).resolves({});
      fetchBuildLogs.mockResolvedValue({
        build: { id: "b1", buildComplete: true, buildStatus: "FAILED" },
        logs: "",
      });

      const res = await GetDeployment(event, context);

      expect(fetchApiGatewayDetails).not.toHaveBeenCalled();
      const values = ddb.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues;
      expect(values).toMatchObject({ ":baseUrl": "", ":apiId": "", ":buildStatus": "FAILED" });
      expect(parseBody(res).data.apiId).toBeUndefined();
    });

    it("looks up the stack with an empty name when the project has none", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [{ ...project, stackName: undefined }, deploymentItem({ buildId: "b1" })],
      });
      ddb.on(UpdateCommand).resolves({});
      fetchBuildLogs.mockResolvedValue({
        build: { id: "b1", buildComplete: true, buildStatus: "SUCCEEDED" },
        logs: "",
      });
      fetchApiGatewayDetails.mockResolvedValue({ apiId: undefined, baseUrl: undefined });

      await GetDeployment(event, context);

      expect(fetchApiGatewayDetails).toHaveBeenCalledWith("", "prod");
    });

    it("builds swagger docs from the stored deployment details", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [
          project,
          deploymentItem({
            isDeploying: false,
            buildStatus: "SUCCEEDED",
            buildComplete: true,
            currentPhase: "COMPLETED",
            apiId: "api1",
            baseUrl: "https://stored",
            deployedAt: "2026-01-02T00:00:00.000Z",
          }),
        ],
      });
      fetchBuildLogs.mockResolvedValue({ build: null, logs: "No logs found" });
      downloadFile.mockResolvedValue(swagger());

      const res = await GetDeployment(event, context);

      expect(fetchBuildLogs).toHaveBeenCalledWith("");
      expect(downloadFile).toHaveBeenCalledWith("p1/swagger-json.json");
      expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
      const data = parseBody(res).data;
      expect(data).toMatchObject({
        buildComplete: true,
        buildStatus: "SUCCEEDED",
        currentPhase: "COMPLETED",
        apiId: "api1",
        baseUrl: "https://stored",
      });
      const doc = JSON.parse(data.swaggerJson);
      expect(doc.servers).toEqual([
        { url: "https://stored", description: "This is the prod server" },
      ]);
      expect(doc.info.title).toBe("API documentation for shop");
      expect(doc.info.description).toContain("project description: desc");
    });

    it("falls back to fresh endpoint details when none are stored", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [project, deploymentItem({ apiId: "api1", buildStatus: "IN_PROGRESS" })],
      });
      ddb.on(UpdateCommand).resolves({});
      fetchBuildLogs.mockResolvedValue({
        build: { id: "b1", buildComplete: true, buildStatus: "SUCCEEDED" },
        logs: "",
      });
      fetchApiGatewayDetails.mockResolvedValue({ apiId: "fresh", baseUrl: "https://fresh" });
      downloadFile.mockResolvedValue(swagger());

      const data = parseBody(await GetDeployment(event, context)).data;

      expect(JSON.parse(data.swaggerJson).servers[0].url).toBe("https://fresh");
      expect(data.baseUrl).toBe("https://fresh");
      expect(data.apiId).toBe("api1");
      expect(data.deployedAt).toBeUndefined();
    });

    it.each([
      ["the build is still running", { buildComplete: false, buildStatus: "IN_PROGRESS" }],
      ["the status is unchanged", { buildComplete: true, buildStatus: "IN_PROGRESS" }],
    ])("does not update when %s", async (_label, build) => {
      ddb.on(QueryCommand).resolves({
        Items: [project, deploymentItem({ buildStatus: "IN_PROGRESS" })],
      });
      fetchBuildLogs.mockResolvedValue({ build, logs: "" });

      const res = await GetDeployment(event, context);

      expect(res.statusCode).toBe(200);
      expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("requires a project id", async () => {
      expect((await GetDeployment(apiEvent(), context)).statusCode).toBe(400);
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 for an unknown project %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      expect((await GetDeployment(event, context)).statusCode).toBe(404);
    });

    it("returns 404 when the project was never deployed", async () => {
      ddb.on(QueryCommand).resolves({ Items: [project] });
      const res = await GetDeployment(event, context);
      expect(parseBody(res).message).toBe("Deployment doesn't exist");
    });

    it("maps validation errors from dependencies to 400", async () => {
      ddb.on(QueryCommand).resolves({ Items: [project, deploymentItem()] });
      fetchBuildLogs.mockRejectedValue(new z.ZodError([]));
      expect((await GetDeployment(event, context)).statusCode).toBe(400);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await GetDeployment(event, context)).statusCode).toBe(500);
    });
  });

  describe("TriggerDeployment", () => {
    const event = apiEvent({ body: { projectId: "p1" } });

    it("creates the deployment record on first deploy", async () => {
      ddb.on(QueryCommand).resolves({ Items: [project] });
      ddb.on(PutCommand).resolves({});

      const res = await TriggerDeployment(event, context);

      const put = ddb.commandCalls(PutCommand)[0].args[0].input;
      expect(put.TableName).toBe(table);
      expect(put.Item).toMatchObject({
        pk: "pr_p1",
        sk: "dp_dep-id",
        entityType: "Deployment",
        isDeploying: false,
      });
      const data = parseBody(res).data;
      expect(data).toMatchObject({ id: "dep-id", projectId: "p1", isDeploying: false });
      expect(data.deployedAt).toBeUndefined();
      expect(publish).toHaveBeenCalledWith({
        type: "deployment triggered",
        payload: {
          projectId: "p1",
          projectName: "shop",
          model: expect.objectContaining({ id: "dep-id" }),
        },
      });
    });

    it("updates the trigger time of an existing deployment", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [
          project,
          deploymentItem({ isDeploying: false, deployedAt: "2026-01-02T00:00:00.000Z", buildId: "b1" }),
        ],
      });
      ddb.on(UpdateCommand).resolves({});

      const res = await TriggerDeployment(event, context);

      expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
      const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.TableName).toBe(table);
      expect(update.Key).toEqual({ pk: "pr_p1", sk: "dp_d1" });
      expect(update.UpdateExpression).toBe("set #triggeredAt = :triggeredAt");
      expect(parseBody(res).data).toMatchObject({
        id: "d1",
        deployedAt: "2026-01-02T00:00:00.000Z",
        buildId: "b1",
      });
    });

    it("refuses while a deployment is in progress", async () => {
      ddb.on(QueryCommand).resolves({ Items: [project, deploymentItem()] });
      const res = await TriggerDeployment(event, context);
      expect(parseBody(res).data).toBe("Deployment is already in progress!");
      expect(publish).not.toHaveBeenCalled();
    });

    it("rejects an invalid body", async () => {
      expect((await TriggerDeployment(apiEvent(), context)).statusCode).toBe(400);
    });

    const model = (name: string, properties: unknown[] = []) => ({
      pk: "pr_p1",
      sk: `ml_${name}`,
      entityType: "Model",
      name,
      properties,
    });

    it.each([
      [
        "an unsafe project name",
        [{ ...project, name: "Shop; rm -rf /" }],
        "Rename the project before deploying: Project name can only contain lowercase letters, numbers and hyphens",
      ],
      [
        "an unsafe model name",
        [project, model("User"), model("order item")],
        'Rename model "order item" before deploying: Model name must be PascalCase',
      ],
      [
        "an unsafe field",
        [project, model("User", [{ name: "first name", type: "string", required: true }])],
        'Rename model "User" before deploying: Field name must be camelCase',
      ],
    ])("refuses to deploy %s saved before the name rules", async (_case, items, message) => {
      ddb.on(QueryCommand).resolves({ Items: items });
      const res = await TriggerDeployment(event, context);
      expect(res.statusCode).toBe(400);
      expect(parseBody(res).message).toContain(message);
      expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
      expect(publish).not.toHaveBeenCalled();
    });

    it("deploys a project whose models follow the rules", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [project, model("User", [{ name: "email", type: "string", required: true }])],
      });
      ddb.on(PutCommand).resolves({});
      expect((await TriggerDeployment(event, context)).statusCode).toBe(200);
    });

    it.each([[{}], [{ Items: [] }]])("returns 404 for an unknown project %#", async (result) => {
      ddb.on(QueryCommand).resolves(result);
      expect((await TriggerDeployment(event, context)).statusCode).toBe(404);
    });

    it("returns 500 on errors", async () => {
      ddb.on(QueryCommand).rejects(new Error("x"));
      expect((await TriggerDeployment(event, context)).statusCode).toBe(500);
    });
  });
});
