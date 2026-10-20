import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../utils/dynamodbClient";
import { Keys } from "../utils/keys";
import { logError, logInfo } from "../utils/logger";

// Projects created before sign-in existed have no ownerId, so no user can see
// them. This gives every such project to one user (their Cognito `sub`).
// Run after a build: node dist/scripts/assignOwnerCli.js <userSub>

/** Assigns ownerless projects to ownerId; returns how many were updated. */
export async function assignOwner(ownerId: string): Promise<number> {
  const TableName = process.env.SERVICE_TABLE ?? "";
  let updated = 0;
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName,
        FilterExpression: "entityType = :type AND attribute_not_exists(ownerId)",
        ExpressionAttributeValues: { ":type": Keys.PROJECT_TYPE },
        ExclusiveStartKey,
      })
    );

    for (const item of page.Items ?? []) {
      await docClient.send(
        new UpdateCommand({
          TableName,
          Key: { pk: item.pk, sk: item.sk },
          UpdateExpression: "set ownerId = :ownerId",
          // Never take a project that got an owner in the meantime.
          ConditionExpression: "attribute_not_exists(ownerId)",
          ExpressionAttributeValues: { ":ownerId": ownerId },
        })
      );
      updated++;
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return updated;
}

/** CLI entry: assignOwner for the user id in args[0]. */
export async function main(args: string[]) {
  const [ownerId] = args;
  if (!ownerId) {
    logError(main.name, "Usage: node dist/scripts/assignOwnerCli.js <userSub>");
    process.exitCode = 1;
    return;
  }

  try {
    const count = await assignOwner(ownerId);
    logInfo(main.name, `Assigned ${count} project(s) to ${ownerId}`);
  } catch (error) {
    logError(main.name, error);
    process.exitCode = 1;
  }
}
