import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { assignOwner, main } from "../../src/scripts/assignOwner";

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddb.reset());
afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe.each([
  ["KanobiTable", "KanobiTable"],
  [undefined, ""],
])("assignOwner (SERVICE_TABLE=%s)", (tableEnv, table) => {
  beforeEach(() => vi.stubEnv("SERVICE_TABLE", tableEnv));

  it("gives every ownerless project to the user, page by page", async () => {
    ddb
      .on(ScanCommand)
      .resolvesOnce({
        Items: [{ pk: "pr_1", sk: "pr_1" }],
        LastEvaluatedKey: { pk: "pr_1", sk: "pr_1" },
      })
      .resolvesOnce({ Items: [{ pk: "pr_2", sk: "pr_2" }] });
    ddb.on(UpdateCommand).resolves({});

    await expect(assignOwner("user-1")).resolves.toBe(2);

    const scans = ddb.commandCalls(ScanCommand).map((c) => c.args[0].input);
    expect(scans[0]).toEqual({
      TableName: table,
      FilterExpression: "entityType = :type AND attribute_not_exists(ownerId)",
      ExpressionAttributeValues: { ":type": "Project" },
      ExclusiveStartKey: undefined,
    });
    expect(scans[1].ExclusiveStartKey).toEqual({ pk: "pr_1", sk: "pr_1" });
    expect(ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input)).toEqual(
      ["pr_1", "pr_2"].map((key) => ({
        TableName: table,
        Key: { pk: key, sk: key },
        UpdateExpression: "set ownerId = :ownerId",
        ConditionExpression: "attribute_not_exists(ownerId)",
        ExpressionAttributeValues: { ":ownerId": "user-1" },
      }))
    );
  });

  it("does nothing when every project has an owner", async () => {
    ddb.on(ScanCommand).resolves({});
    await expect(assignOwner("user-1")).resolves.toBe(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe("main", () => {
  it("assigns the projects and reports the count", async () => {
    ddb.on(ScanCommand).resolves({ Items: [{ pk: "pr_1", sk: "pr_1" }] });
    ddb.on(UpdateCommand).resolves({});

    await main(["user-1"]);

    expect(console.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "MAIN",
      "Assigned 1 project(s) to user-1"
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("requires a user id", async () => {
    await main([]);
    expect(ddb.calls()).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it("fails on errors", async () => {
    ddb.on(ScanCommand).rejects(new Error("denied"));
    await main(["user-1"]);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });
});
