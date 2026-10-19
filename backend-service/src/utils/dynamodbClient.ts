import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  CreateTableCommand,
  DescribeTableCommand,
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

export async function initDb(tableName: string) {
  try {
    if (process.env.NODE_ENV != "dev") return;

    await client.send(new DescribeTableCommand({ TableName: tableName }));
    logInfo(initDb.name, `Table ${tableName} already exists`);
  } catch (err: any) {
    if (err.name === "ResourceNotFoundException") {
      logInfo(initDb.name, `Creating table ${tableName}...`);
      await client.send(
        new CreateTableCommand({
          TableName: tableName,
          AttributeDefinitions: [
            { AttributeName: "pk", AttributeType: "S" },
            { AttributeName: "sk", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "pk", KeyType: "HASH" },
            { AttributeName: "sk", KeyType: "RANGE" },
          ],
          BillingMode: "PAY_PER_REQUEST",
        })
      );
      logInfo(initDb.name, `Table ${tableName} created`);
    } else {
      logError(initDb.name, err);
    }
  }
}
