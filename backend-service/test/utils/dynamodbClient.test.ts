import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
} from "@aws-sdk/client-dynamodb";

const dynamo = mockClient(DynamoDBClient);

const load = async (nodeEnv: string) => {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("../../src/utils/dynamodbClient");
};

beforeEach(() => dynamo.reset());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dynamodbClient", () => {
  it("targets the deploy region outside dev", async () => {
    const { initDb, docClient } = await load("test");
    expect(await docClient.config.region()).toBe("eu-west-1");
    expect(docClient.config.endpoint).toBeUndefined();

    await initDb("table");
    expect(dynamo.calls()).toHaveLength(0);
  });

  it("targets the local endpoint in dev", async () => {
    const { docClient } = await load("dev");
    expect(await docClient.config.region()).toBe("localhost");
    expect(await docClient.config.endpoint?.()).toMatchObject({
      hostname: "localhost",
      port: 8000,
    });
  });

  it("uses the default credential chain (the Lambda role) outside dev", async () => {
    vi.stubEnv("AWS_KEY", "static-key");
    vi.stubEnv("AWS_SECRET", "static-secret");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "role-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "role-secret");
    const { docClient } = await load("test");
    expect(await docClient.config.credentials()).toMatchObject({
      accessKeyId: "role-key",
      secretAccessKey: "role-secret",
    });
  });

  it("uses dummy credentials for the local endpoint in dev", async () => {
    vi.stubEnv("AWS_KEY", "static-key");
    const { docClient } = await load("dev");
    expect(await docClient.config.credentials()).toMatchObject({
      accessKeyId: "test",
      secretAccessKey: "test",
    });
  });

  it("leaves an existing table with the owner index alone", async () => {
    const { initDb } = await load("dev");
    dynamo.on(DescribeTableCommand).resolves({
      Table: { GlobalSecondaryIndexes: [{ IndexName: "byOwner" }] },
    });
    await initDb("table");
    expect(dynamo.commandCalls(CreateTableCommand)).toHaveLength(0);
    expect(dynamo.commandCalls(UpdateTableCommand)).toHaveLength(0);
  });

  it.each([
    ["no indexes", {}],
    ["other indexes", { Table: { GlobalSecondaryIndexes: [{ IndexName: "other" }] } }],
  ])("adds the owner index to an existing table with %s", async (_case, described) => {
    const { initDb } = await load("dev");
    dynamo.on(DescribeTableCommand).resolves(described);
    dynamo.on(UpdateTableCommand).resolves({});

    await initDb("table");

    expect(dynamo.commandCalls(UpdateTableCommand)[0].args[0].input).toEqual({
      TableName: "table",
      AttributeDefinitions: [
        { AttributeName: "ownerId", AttributeType: "S" },
        { AttributeName: "pk", AttributeType: "S" },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: "byOwner",
            KeySchema: [
              { AttributeName: "ownerId", KeyType: "HASH" },
              { AttributeName: "pk", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        },
      ],
    });
  });

  it("creates a missing table", async () => {
    const { initDb } = await load("dev");
    dynamo
      .on(DescribeTableCommand)
      .rejects(Object.assign(new Error("missing"), { name: "ResourceNotFoundException" }));
    await initDb("table");
    expect(dynamo.commandCalls(CreateTableCommand)[0].args[0].input).toMatchObject({
      TableName: "table",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "ownerId", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "byOwner",
          KeySchema: [
            { AttributeName: "ownerId", KeyType: "HASH" },
            { AttributeName: "pk", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    });
  });

  it("logs other errors", async () => {
    const { initDb } = await load("dev");
    dynamo.on(DescribeTableCommand).rejects(new Error("denied"));
    await initDb("table");
    expect(dynamo.commandCalls(CreateTableCommand)).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });
});
