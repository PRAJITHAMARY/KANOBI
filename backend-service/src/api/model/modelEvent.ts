import yaml from "js-yaml";
import { logError, logInfo } from "../../utils/logger";
import {
  downloadFile,
  getSource,
  streamToString,
  uploadFile,
} from "../../utils/S3Client";
import { CreateModel, CreateModelResponseDto } from "./model.dto";
import { getTableName } from "../../utils/dynamodbHelpers";
import { DeleteAPIFunction, SetupAPIFunction } from "../../utils/codeBuilder";
import { getServiceName } from "../../utils/infraHelper";

export const MODEL_CREATED = "model created";
export const MODEL_DELETED = "model deleted";
export const MODEL_UPDATED = "model updated";

export interface ModelCreatedPayload {
  projectId: string | undefined;
  model: CreateModelResponseDto;
}

export interface ModelDeletedPayload {
  projectId: string | undefined;
  model: CreateModelResponseDto;
}

export interface ModelUpdatedPayload {
  projectId: string | undefined;
  models: CreateModel[];
}

export interface RelationshipUpdatedPayload {
  projectId: string | undefined;
  relationships: CreateModel[];
}

export const modelCreatedHandler = async (payload: ModelCreatedPayload) => {
  try {
    const model = payload.model;
    const indexKey = `${payload.projectId}/src/index.ts`;
    const indexTempateKey = `${payload.projectId}/src/indexTemplate.ts`;
    const yamlKey = `${payload.projectId}/serverless.yml`;

    const indexSource = await getSource(indexKey);
    const templateSource = await getSource(indexTempateKey);

    const ymlData = await streamToString(await downloadFile(yamlKey));
    const doc = yaml.load(ymlData) as any;
    const serviceName = getServiceName(payload.projectId || "");

    const environment = doc.provider.environment;
    let resources = doc.resources.Resources;
    let functions = doc.functions;
    let statements = doc.provider.iam.role.statements;

    if (!resources) {
      resources = {};
      doc.resources.Resources = resources;
    }

    if (!functions) {
      functions = {};
      doc.functions = functions;
    }

    if (!statements) {
      statements = [];
      doc.provider.iam.role.statements = statements;
    }

    await SetupAPIFunction(
      templateSource,
      indexSource,
      model as any,
      functions,
      payload.projectId
    );

    logInfo("", "Allocating resources for " + model.name);

    resources[getTableName(payload.projectId, model.name)] = {
      Type: "AWS::DynamoDB::Table",
      Properties: {
        TableName: getTableName(payload.projectId, model.name),
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      },
      Tags: [
        {
          Key: "Service",
          Value: serviceName,
        },
        {
          Key: "Project",
          Value: payload.projectId,
        },
      ],
    };

    environment[getTableName(payload.projectId, model.name).toUpperCase()] =
      getTableName(payload.projectId, model.name);

    const resource = statements.find((x: any) =>
      x.Action.includes("dynamodb:PutItem")
    )?.Resource;

    if (resource) {
      resource.push(
        `arn:aws:dynamodb:${
          process.env.AWS_DEPLOY_REGION
        }:*:table/${getTableName(payload.projectId, model.name)}`
      );
    } else {
      statements.push({
        Effect: "Allow",
        Action: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
        ],
        Resource: [
          `arn:aws:dynamodb:${
            process.env.AWS_DEPLOY_REGION
          }:*:table/${getTableName(payload.projectId, model.name)}`,
        ],
      });
    }

    await indexSource.save();
    await uploadFile(indexKey, indexSource.getFullText());
    await uploadFile(yamlKey, yaml.dump(doc));

    logInfo(modelCreatedHandler.name, "Created model!");
    return true;
  } catch (error) {
    logError(modelCreatedHandler.name, error);
  }
};

export const modelDeletedHandler = async (payload: ModelDeletedPayload) => {
  const model = payload.model;

  const indexKey = `${payload.projectId}/src/index.ts`;
  const yamlKey = `${payload.projectId}/serverless.yml`;

  const indexSource = await getSource(indexKey);

  const ymlData = await streamToString(await downloadFile(yamlKey));
  const doc = yaml.load(ymlData) as any;

  const environment = doc.provider.environment;
  const resources = doc.resources.Resources;
  const functions = doc.functions;

  await DeleteAPIFunction(indexSource, model as any, functions);

  logInfo("", "Deallocating resources for " + model.name);
  delete resources[getTableName(payload.projectId, model.name)];
  delete environment[getTableName(payload.projectId, model.name).toUpperCase()];

  await indexSource.save();

  await uploadFile(indexKey, indexSource.getFullText());
  await uploadFile(yamlKey, yaml.dump(doc));

  logInfo(modelDeletedHandler.name, "Deleted model!");
};

export const modelUpdatedHandler = async (payload: ModelUpdatedPayload) => {
  const models = payload.models;

  const indexTempateKey = `${payload.projectId}/src/indexTemplate.ts`;
  const indexKey = `${payload.projectId}/src/index.ts`;
  const yamlKey = `${payload.projectId}/serverless.yml`;

  const indexSource = await getSource(indexKey);
  const templateSource = await getSource(indexTempateKey);

  const ymlData = await streamToString(await downloadFile(yamlKey));
  const doc = yaml.load(ymlData) as any;

  const environment = doc.provider.environment;
  const resources = doc.resources.Resources;
  const functions = doc.functions;

  for (let model of models) {
    DeleteAPIFunction(indexSource, model as any, functions);

    logInfo("", "Deallocating resources for " + model.name);
    delete resources[getTableName(payload.projectId, model.name)];
    delete environment[
      getTableName(payload.projectId, model.name).toUpperCase()
    ];

    logInfo("", "Allocating resources for " + model.name);
    resources[getTableName(payload.projectId, model.name)] = {
      Type: "AWS::DynamoDB::Table",
      Properties: {
        TableName: getTableName(payload.projectId, model.name),
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      },
    };

    environment[getTableName(payload.projectId, model.name).toUpperCase()] =
      getTableName(payload.projectId, model.name);

    await SetupAPIFunction(
      templateSource,
      indexSource,
      model as any,
      functions,
      payload.projectId
    );
  }

  await indexSource.save();

  await uploadFile(indexKey, indexSource.getFullText());
  await uploadFile(yamlKey, yaml.dump(doc));

  logInfo(modelUpdatedHandler.name, "Updated model!");
};
