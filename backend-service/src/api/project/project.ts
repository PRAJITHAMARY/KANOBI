import "reflect-metadata";
import {
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../utils/dynamodbClient";
import { v4 as uuidv4 } from "uuid";
import { Context, APIGatewayProxyEvent } from "aws-lambda";
import {
  CreateProjectDto,
  CreateProjectDtoSchema,
  CreateProjectResponseDto,
  ProjectModel,
} from "./project.dto";
import { z } from "zod";
import { EventHub } from "../../utils/eventhub";
import {
  PROJECT_CREATED,
  PROJECT_DELETED,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
} from "./projectEvent";
import {
  getId,
  getPutOperators,
  sanitizeData,
} from "../../utils/dynamodbHelpers";
import { ResponseManager } from "../../utils/responseManager";
import { Keys } from "../../utils/keys";
import { CreateModelResponseDto } from "../model/model.dto";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  getServiceName,
  getStackCurrentCost,
  getStackMonthlyCost,
} from "../../utils/infraHelper";
import {
  authErrorResponse,
  getUserId,
  requireProjectOwner,
} from "../../utils/auth";

/** GSI listing a user's projects (ownerId, pk). */
export const OWNER_INDEX = "byOwner";

/** Cost Explorer is billed per request, so a project's cost is cached this long. */
export const COST_CACHE_MS = 60 * 60 * 1000;

/** A project row as returned by the API, without internal fields. */
const toProjectResponse = (item: Record<string, any>) => {
  const { ownerId, cost, ...rest } = item;
  return sanitizeData<CreateProjectResponseDto>(rest);
};

export async function CreateProject(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const ownerId = getUserId(event);
    const body = CreateProjectDtoSchema.parse(
      JSON.parse(event.body || "{}") as CreateProjectDto
    );

    const id = uuidv4();
    const itemToSave: ProjectModel = {
      pk: Keys.PROJECT + id,
      sk: Keys.PROJECT + id,
      entityType: Keys.PROJECT_TYPE,
      ownerId,
      ...body,
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        Item: itemToSave,
      })
    );

    const response: CreateProjectResponseDto = { id, ...body };
    await EventHub.Get().publish<ProjectCreatedPayload>({
      type: PROJECT_CREATED,
      payload: response,
    });

    return ResponseManager.CreatedResponse(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(CreateProject.name, error)
    );
  }
}

export async function GetProjects(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const ownerId = getUserId(event);
    const nextPageToken = event.queryStringParameters?.nextPageToken;

    // Only project rows carry ownerId, so the index holds nothing else.
    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        IndexName: OWNER_INDEX,
        KeyConditionExpression: "ownerId = :ownerId",
        ExpressionAttributeValues: { ":ownerId": ownerId },
        Limit: Number(event.queryStringParameters?.take) || 20,
        ExclusiveStartKey: nextPageToken
          ? {
              ownerId,
              pk: Keys.PROJECT + nextPageToken,
              sk: Keys.PROJECT + nextPageToken,
            }
          : undefined,
      })
    );

    const response = (result.Items ?? []).map(toProjectResponse);

    return ResponseManager.OkResponse<CreateProjectResponseDto[]>(response, {
      count: result.Count,
      hasMore: result.LastEvaluatedKey != undefined,
      nextPageToken:
        result.LastEvaluatedKey != undefined
          ? getId(result.LastEvaluatedKey?.pk)
          : undefined,
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(GetProjects.name, error)
    );
  }
}

export async function GetProjectCost(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const id = event.pathParameters?.id;
    const project = await requireProjectOwner(id, getUserId(event));

    const cached = project.cost;
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < COST_CACHE_MS) {
      return ResponseManager.OkResponse({
        currentCost: cached.currentCost,
        projectedCost: cached.projectedCost,
      });
    }

    const projectId = getId(project.pk);
    const currentCost = await getStackCurrentCost("Project", projectId);
    const projectedCost = await getStackMonthlyCost(
      "Service",
      getServiceName(projectId)
    );

    const cost = {
      currentCost: {
        amount: currentCost?.amount,
        currency: currentCost?.currency,
      },
      projectedCost: {
        amount: projectedCost?.amount,
        currency: projectedCost?.currency,
      },
    };

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        Key: { pk: project.pk, sk: project.sk },
        UpdateExpression: "set #cost = :cost",
        ExpressionAttributeNames: { "#cost": "cost" },
        ExpressionAttributeValues: {
          ":cost": { ...cost, fetchedAt: new Date().toISOString() },
        },
      })
    );

    return ResponseManager.OkResponse(cost);
  } catch (error) {
    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(GetProjectCost.name, error)
    );
  }
}

export async function GetOneProject(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const id = event.pathParameters?.id;
    await requireProjectOwner(id, getUserId(event));

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + id,
        },
      })
    );

    if (!result.Items || result.Items.length < 1) {
      return ResponseManager.NotfoundResponse(
        "Project with id: " + id + " Not found"
      );
    }

    const projectItem = result.Items.find(
      (x) => x.entityType == Keys.PROJECT_TYPE
    );

    if (!projectItem) {
      return ResponseManager.NotfoundResponse(
        "Project with id: " + id + " Not found"
      );
    }
    const project = toProjectResponse(projectItem);

    const models = result.Items.filter(
      (x) => x.entityType == Keys.MODEL_TYPE
    ).map((y) => sanitizeData<CreateModelResponseDto>(y, "sk"));

    return ResponseManager.OkResponse({
      ...project,
      models: models,
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(GetOneProject.name, error)
    );
  }
}

export async function PutProject(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const id = event.pathParameters?.id;
    const userId = getUserId(event);
    const body = CreateProjectDtoSchema.parse(
      JSON.parse(event.body || "{}") as Omit<CreateProjectDto, "id">
    );

    // Also stops an update from creating a row for an unknown id.
    await requireProjectOwner(id, userId);

    const {
      updateExpression,
      expressionAttributeNames,
      expressionAttributeValues,
    } = getPutOperators(body);

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SERVICE_TABLE ?? "",
        Key: { pk: Keys.PROJECT + id, sk: Keys.PROJECT + id },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    const item: CreateProjectResponseDto = { id: id as string, ...body };

    return ResponseManager.OkResponse(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(PutProject.name, error)
    );
  }
}

export async function DeleteProject(event: any): Promise<any> {
  try {
    const id = event.pathParameters?.id;
    await requireProjectOwner(id, getUserId(event));

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + id,
        },
      })
    );

    if (!result.Items) {
      return ResponseManager.NotfoundResponse(
        "Project with id: " + id + " Not found"
      );
    }

    const project = result.Items.find(
      (x) => x.entityType == Keys.PROJECT_TYPE
    ) as ProjectModel;

    if (!project) {
      return ResponseManager.NotfoundResponse(
        "Project with id: " + id + " Not found"
      );
    }

    const itemsToDelete = result.Items.map((item) => ({
      DeleteRequest: {
        Key: {
          pk: item.pk,
          sk: item.sk,
        },
      },
    }));

    const chunks = [];
    while (itemsToDelete.length) {
      chunks.push(itemsToDelete.splice(0, 25));
    }

    for (const chunk of chunks) {
      const batchParams = {
        RequestItems: {
          [process.env.SERVICE_TABLE ?? ""]: chunk,
        },
      };

      const result = await docClient.send(new BatchWriteCommand(batchParams));

      if (
        result.UnprocessedItems &&
        Object.keys(result.UnprocessedItems).length
      ) {
        console.warn(
          "Some items were not processed. You may need to retry:",
          result.UnprocessedItems
        );
      }
    }

    await EventHub.Get().publish<ProjectDeletedPayload>({
      type: PROJECT_DELETED,
      payload: { id, stackName: project.stackName },
    });

    return ResponseManager.NoContentResponse();
  } catch (error) {
    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(DeleteProject.name, error)
    );
  }
}
