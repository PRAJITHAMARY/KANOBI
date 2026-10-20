import "reflect-metadata";
import {
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../utils/dynamodbClient";
import { v4 as uuidv4 } from "uuid";
import { Context, APIGatewayProxyEvent } from "aws-lambda";
import { z } from "zod";
import { EventHub } from "../../utils/eventhub";
import {
  sanitizeData,
  getPutOperators,
  getTableName,
} from "../../utils/dynamodbHelpers";
import {
  CreateModelDto,
  CreateModelDtoSchema,
  CreateModelResponseDto,
  CreateModel,
  UpdateModelApiSchema,
  UpdateRelationsSchema,
  relationships,
} from "./model.dto";
import { ResponseManager } from "../../utils/responseManager";
import { sameName } from "../../utils/names";
import { Keys } from "../../utils/keys";
import {
  MODEL_CREATED,
  MODEL_DELETED,
  MODEL_UPDATED,
  ModelCreatedPayload,
  ModelDeletedPayload,
  ModelUpdatedPayload,
} from "./modelEvent";

export async function CreateModel(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const body = CreateModelDtoSchema.parse(
      JSON.parse(event.body || "{}") as CreateModelDto
    );

    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
        },
      })
    );

    const project = result.Items;

    if (!project || project.length < 1) {
      return ResponseManager.NotfoundResponse(
        "Project with id: " + projectId + " doesn't exist"
      );
    }

    const existingModel = project.find(
      (x) => x.entityType == Keys.MODEL_TYPE && sameName(x.name, body.name)
    );

    if (existingModel) {
      return ResponseManager.BadRequestResponse(
        "Model already exists in project",
        `A model named ${existingModel.name} already exists`
      );
    }

    const modelId = uuidv4();

    const modelToSave: CreateModel = {
      pk: Keys.PROJECT + projectId,
      sk: Keys.MODEL + modelId,
      entityType: Keys.MODEL_TYPE,
      apis: [
        { method: "getone", generate: true },
        { method: "get", generate: true },
        { method: "post", generate: true },
        { method: "put", generate: true },
        { method: "delete", generate: true },
        { method: "postmultiple", generate: true },
        { method: "deletemultiple", generate: true },
      ],
      ...body,
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        Item: modelToSave,
      })
    );

    const item: CreateModelResponseDto = sanitizeData<CreateModelResponseDto>(
      modelToSave,
      "sk"
    );

    await EventHub.Get().publish<ModelCreatedPayload>({
      type: MODEL_CREATED,
      payload: {
        projectId,
        model: item,
      },
    });

    return ResponseManager.CreatedResponse(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return ResponseManager.InternalErrorResponse(CreateModel.name, error);
  }
}

export async function GetModels(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        KeyConditionExpression: "pk = :pk",
        FilterExpression: "entityType = :type",
        ExpressionAttributeValues: {
          ":type": Keys.MODEL_TYPE,
          ":pk": Keys.PROJECT + projectId,
        },
      })
    );

    if (!result.Items || result.Items.length < 1) {
      result.Items = [];
    }

    const response = result.Items.map((x) =>
      sanitizeData<CreateModelResponseDto>(x, "sk")
    );

    return ResponseManager.OkResponse<CreateModelResponseDto[]>(response, {
      count: result.Count,
    });
  } catch (error) {
    return ResponseManager.InternalErrorResponse(GetModels.name, error);
  }
}

export async function GetOneModel(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const modelId = event.pathParameters?.modelId;
    if (!modelId) {
      return ResponseManager.BadRequestResponse("Model Id must be valid");
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
          ":sk": Keys.MODEL + modelId,
        },
      })
    );

    if (!result.Items || result.Items.length < 1) {
      return ResponseManager.NotfoundResponse();
    }

    const model = sanitizeData<CreateModelResponseDto>(
      result.Items.find((x) => x.entityType == Keys.MODEL_TYPE),
      "sk"
    );

    return ResponseManager.OkResponse(model);
  } catch (error) {
    return ResponseManager.InternalErrorResponse(GetModels.name, error);
  }
}

export async function PutModel(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const modelId = event.pathParameters?.modelId;
    if (!modelId) {
      return ResponseManager.BadRequestResponse("Model Id must be valid");
    }

    const body = CreateModelDtoSchema.parse(
      JSON.parse(event.body || "{}") as Omit<CreateModelDto, "id">
    );

    const projectItems = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
        },
      })
    );

    const clash = projectItems.Items?.find(
      (x) =>
        x.entityType == Keys.MODEL_TYPE &&
        x.sk != Keys.MODEL + modelId &&
        sameName(x.name, body.name)
    );

    if (clash) {
      return ResponseManager.BadRequestResponse(
        "Model already exists in project",
        `A model named ${clash.name} already exists`
      );
    }

    const {
      updateExpression,
      expressionAttributeNames,
      expressionAttributeValues,
    } = getPutOperators(body);

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        Key: { pk: Keys.PROJECT + projectId, sk: Keys.MODEL + modelId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
          ":sk": Keys.MODEL + modelId,
        },
      })
    );

    if (!result.Items || result.Items.length < 1) {
      return ResponseManager.NotfoundResponse();
    }

    const model = sanitizeData<CreateModelResponseDto>(
      result.Items.find((x) => x.entityType == Keys.MODEL_TYPE),
      "sk"
    );

    await EventHub.Get().publish<ModelUpdatedPayload>({
      type: MODEL_UPDATED,
      payload: {
        models: [
          result.Items.find(
            (x) => x.entityType == Keys.MODEL_TYPE
          ) as CreateModel,
        ],
        projectId,
      },
    });

    return ResponseManager.OkResponse(model);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return ResponseManager.InternalErrorResponse(GetModels.name, error);
  }
}

export async function PutModelAPI(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const modelId = event.pathParameters?.modelId;
    if (!modelId) {
      return ResponseManager.BadRequestResponse("Model Id must be valid");
    }

    const body = UpdateModelApiSchema.parse(JSON.parse(event.body || "{}"));

    const {
      updateExpression,
      expressionAttributeNames,
      expressionAttributeValues,
    } = getPutOperators(body);

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        Key: { pk: Keys.PROJECT + projectId, sk: Keys.MODEL + modelId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
          ":sk": Keys.MODEL + modelId,
        },
      })
    );

    if (!result.Items || result.Items.length < 1) {
      return ResponseManager.NotfoundResponse();
    }

    const model = sanitizeData<CreateModelResponseDto>(
      result.Items.find((x) => x.entityType == Keys.MODEL_TYPE),
      "sk"
    );

    await EventHub.Get().publish<ModelUpdatedPayload>({
      type: MODEL_UPDATED,
      payload: {
        models: [
          result.Items.find(
            (x) => x.entityType == Keys.MODEL_TYPE
          ) as CreateModel,
        ],
        projectId,
      },
    });

    return ResponseManager.OkResponse(model);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return ResponseManager.InternalErrorResponse(GetModels.name, error);
  }
}

export async function CreateModelRelations(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const modelId = event.pathParameters?.modelId;
    if (!modelId) {
      return ResponseManager.BadRequestResponse("Model Id must be valid");
    }

    const modelResult = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
          ":sk": Keys.MODEL + modelId,
        },
      })
    );

    if (!modelResult.Items || modelResult.Items.length < 1) {
      return ResponseManager.NotfoundResponse();
    }

    const mainModel = modelResult.Items.find(
      (x) => x.entityType == Keys.MODEL_TYPE
    ) as CreateModel;

    const body = UpdateRelationsSchema.parse(JSON.parse(event.body || "{}"));
    const relations = [];
    const requests: Promise<any>[] = [];
    const involvedModels: CreateModel[] = [];

    for (const relation of body.relations) {
      const relatedModel = await docClient.send(
        new QueryCommand({
          TableName: process.env.SERVICE_TABLE,
          KeyConditionExpression: "pk = :pk AND sk = :sk",
          ExpressionAttributeValues: {
            ":pk": Keys.PROJECT + projectId,
            ":sk": Keys.MODEL + relation.modelId,
          },
        })
      );

      if (!relatedModel.Items || relatedModel.Items.length < 1) {
        continue;
      }

      const model = relatedModel.Items.find(
        (x) => x.entityType == Keys.MODEL_TYPE
      ) as CreateModel;

      relations.push({
        modelId: model.sk.split("_")[1],
        mainModel: mainModel.name,
        relatedModel: model.name,
        relationship: relation.relationship,
        tableName: getTableName(projectId, model.name),
      });

      if (!model.relations) model.relations = [];
      if (model.relations.find((x) => x.modelId == modelId)) {
        model.relations = model.relations.filter((x) => x.modelId != modelId);
      }

      model.relations.push({
        modelId: modelId,
        mainModel: model.name,
        relatedModel: mainModel.name,
        relationship: relationships[relation.relationship],
        tableName: getTableName(projectId, mainModel.name),
      });

      involvedModels.push(model);

      const {
        updateExpression,
        expressionAttributeNames,
        expressionAttributeValues,
      } = getPutOperators({ relations: model.relations });

      requests.push(
        docClient.send(
          new UpdateCommand({
            TableName: process.env.SERVICE_TABLE ?? "",
            Key: { pk: Keys.PROJECT + projectId, sk: model.sk },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
          })
        )
      );
    }

    const {
      updateExpression,
      expressionAttributeNames,
      expressionAttributeValues,
    } = getPutOperators({ relations: relations });

    requests.push(
      docClient.send(
        new UpdateCommand({
          TableName: process.env.SERVICE_TABLE ?? "",
          Key: { pk: Keys.PROJECT + projectId, sk: Keys.MODEL + modelId },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      )
    );

    await Promise.all(requests);

    //@ts-ignore
    mainModel.relations = relations;

    involvedModels.push({ ...structuredClone(mainModel) });

    const model = sanitizeData<CreateModelResponseDto>(mainModel, "sk");

    await EventHub.Get().publish<ModelUpdatedPayload>({
      type: MODEL_UPDATED,
      payload: {
        models: involvedModels,
        projectId,
      },
    });

    return ResponseManager.OkResponse(model);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return ResponseManager.InternalErrorResponse(GetModels.name, error);
  }
}

export async function DeleteModelRelations(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const modelId = event.pathParameters?.modelId;
    if (!modelId) {
      return ResponseManager.BadRequestResponse("Model Id must be valid");
    }

    const modelResult = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
          ":sk": Keys.MODEL + modelId,
        },
      })
    );

    if (!modelResult.Items || modelResult.Items.length < 1) {
      return ResponseManager.NotfoundResponse();
    }

    const mainModel = modelResult.Items.find(
      (x) => x.entityType == Keys.MODEL_TYPE
    ) as CreateModel;

    const body = UpdateRelationsSchema.parse(JSON.parse(event.body || "{}"));
    let relations = mainModel.relations || [];
    const requests: Promise<any>[] = [];
    const involvedModels: CreateModel[] = [];

    for (const relation of body.relations) {
      const relatedModel = await docClient.send(
        new QueryCommand({
          TableName: process.env.SERVICE_TABLE,
          KeyConditionExpression: "pk = :pk AND sk = :sk",
          ExpressionAttributeValues: {
            ":pk": Keys.PROJECT + projectId,
            ":sk": Keys.MODEL + relation.modelId,
          },
        })
      );

      if (!relatedModel.Items || relatedModel.Items.length < 1) {
        continue;
      }

      const model = relatedModel.Items.find(
        (x) => x.entityType == Keys.MODEL_TYPE
      ) as CreateModel;

      relations = relations.filter((x) => x.modelId != model.sk.split("_")[1]);

      if (!model.relations) continue;

      const existing = model.relations.find((x) => x.modelId == modelId);
      if (!existing) continue;

      model.relations = model.relations.filter((x) => x.modelId != modelId);
      involvedModels.push(model);

      const {
        updateExpression,
        expressionAttributeNames,
        expressionAttributeValues,
      } = getPutOperators({ relations: model.relations });

      requests.push(
        docClient.send(
          new UpdateCommand({
            TableName: process.env.SERVICE_TABLE ?? "",
            Key: { pk: Keys.PROJECT + projectId, sk: model.sk },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
          })
        )
      );
    }

    const {
      updateExpression,
      expressionAttributeNames,
      expressionAttributeValues,
    } = getPutOperators({ relations: relations });

    requests.push(
      docClient.send(
        new UpdateCommand({
          TableName: process.env.SERVICE_TABLE ?? "",
          Key: { pk: Keys.PROJECT + projectId, sk: Keys.MODEL + modelId },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      )
    );

    await Promise.all(requests);

    mainModel.relations = relations;
    involvedModels.push({ ...structuredClone(mainModel) });

    const model = sanitizeData<CreateModelResponseDto>(mainModel, "sk");

    await EventHub.Get().publish<ModelUpdatedPayload>({
      type: MODEL_UPDATED,
      payload: {
        models: involvedModels,
        projectId,
      },
    });

    return ResponseManager.OkResponse(model);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return ResponseManager.InternalErrorResponse(GetModels.name, error);
  }
}

export async function DeleteModel(event: any): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    const modelId = event.pathParameters?.modelId;
    if (!modelId) {
      return ResponseManager.BadRequestResponse("Model Id must be valid");
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
          ":sk": Keys.MODEL + modelId,
        },
      })
    );

    if (!result.Items || result.Items.length < 1) {
      return ResponseManager.NotfoundResponse();
    }

    const model = sanitizeData<CreateModelResponseDto>(
      result.Items.find((x) => x.entityType == Keys.MODEL_TYPE),
      "sk"
    );

    const requests: Promise<any>[] = [];

    for (const relation of model.relations || []) {
      const relatedModelResult = await docClient.send(
        new QueryCommand({
          TableName: process.env.SERVICE_TABLE,
          KeyConditionExpression: "pk = :pk AND sk = :sk",
          ExpressionAttributeValues: {
            ":pk": Keys.PROJECT + projectId,
            ":sk": Keys.MODEL + relation.modelId,
          },
        })
      );

      if (!relatedModelResult.Items || relatedModelResult.Items.length < 1) {
        continue;
      }

      const relatedModel = sanitizeData<CreateModelResponseDto>(
        relatedModelResult.Items.find((x) => x.entityType == Keys.MODEL_TYPE),
        "sk"
      );

      if (!relatedModel.relations) {
        continue;
      }

      if (relatedModel.relations.find((x) => x.modelId == modelId)) {
        model.relations = relatedModel.relations.filter(
          (x) => x.modelId != modelId
        );
      }

      const {
        updateExpression,
        expressionAttributeNames,
        expressionAttributeValues,
      } = getPutOperators({ relations: model.relations });

      requests.push(
        docClient.send(
          new UpdateCommand({
            TableName: process.env.SERVICE_TABLE ?? "",
            Key: { pk: Keys.PROJECT + projectId, sk: Keys.MODEL + model.id },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
          })
        )
      );
    }

    requests.push(
      docClient.send(
        new DeleteCommand({
          TableName: process.env.SERVICE_TABLE ?? "",
          Key: { pk: Keys.PROJECT + projectId, sk: Keys.MODEL + modelId },
        })
      )
    );

    await Promise.all(requests);

    await EventHub.Get().publish<ModelDeletedPayload>({
      type: MODEL_DELETED,
      payload: {
        model,
        projectId,
      },
    });

    return ResponseManager.NoContentResponse();
  } catch (error) {
    return ResponseManager.InternalErrorResponse(GetModels.name, error);
  }
}
