import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTableCommand,
} from "@aws-sdk/client-dynamodb";
import { logError, logInfo } from "./logger";
import { localEndpointConfig } from "./awsConfig";

const client = new DynamoDBClient({
  region: process.env.NODE_ENV == "dev" ? "localhost" : process.env.AWS_DEPLOY_REGION,
  ...(process.env.NODE_ENV == "dev"
    ? localEndpointConfig(process.env.DYNAMODB_ENDPOINT)
    : {}),
});

export const docClient = DynamoDBDocumentClient.from(client);

// Lists a user's projects (see GetProjects); matches KanobiTable in serverless.yml.
const OWNER_INDEX = {
  IndexName: "byOwner",
  KeySchema: [
    { AttributeName: "ownerId", KeyType: "HASH" as const },
    { AttributeName: "pk", KeyType: "RANGE" as const },
  ],
  Projection: { ProjectionType: "ALL" as const },
};

export async function initDb(tableName: string) {
  try {
    if (process.env.NODE_ENV != "dev") return;

    const { Table } = await client.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    logInfo(initDb.name, `Table ${tableName} already exists`);

    // Tables created before projects had owners lack the index.
    if (!Table?.GlobalSecondaryIndexes?.some((i) => i.IndexName === OWNER_INDEX.IndexName)) {
      logInfo(initDb.name, `Adding index ${OWNER_INDEX.IndexName} to ${tableName}`);
      await client.send(
        new UpdateTableCommand({
          TableName: tableName,
          AttributeDefinitions: [
            { AttributeName: "ownerId", AttributeType: "S" },
            { AttributeName: "pk", AttributeType: "S" },
          ],
          GlobalSecondaryIndexUpdates: [{ Create: OWNER_INDEX }],
        })
      );
    }
  } catch (err: any) {
    if (err.name === "ResourceNotFoundException") {
      logInfo(initDb.name, `Creating table ${tableName}...`);
      await client.send(
        new CreateTableCommand({
          TableName: tableName,
          AttributeDefinitions: [
            { AttributeName: "pk", AttributeType: "S" },
            { AttributeName: "sk", AttributeType: "S" },
            { AttributeName: "ownerId", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "pk", KeyType: "HASH" },
            { AttributeName: "sk", KeyType: "RANGE" },
          ],
          GlobalSecondaryIndexes: [OWNER_INDEX],
          BillingMode: "PAY_PER_REQUEST",
        })
      );
      logInfo(initDb.name, `Table ${tableName} created`);
    } else {
      logError(initDb.name, err);
    }
  }
}
