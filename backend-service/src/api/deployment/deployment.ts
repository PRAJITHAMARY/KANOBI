import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { docClient } from "../../utils/dynamodbClient";
import {
  DeploymentModel,
  DeploymentResponseDto,
  TriggerDeploymentDto,
  TriggerDeploymentDtoSchema,
} from "./deployment.dto";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Keys } from "../../utils/keys";
import { ResponseManager } from "../../utils/responseManager";
import { v4 as uuidv4 } from "uuid";
import { getPutOperators } from "../../utils/dynamodbHelpers";
import { z } from "zod";
import { EventHub } from "../../utils/eventhub";
import {
  DEPLOYMENT_TRIGGERED,
  DeploymentTriggeredPayload,
} from "./deploymentEvent";
import {
  exportSwagger,
  fetchApiGatewayDetails,
  FetchBuildLogs,
} from "../../utils/infraHelper";
import { StatusType } from "@aws-sdk/client-codebuild";
import { ProjectModel } from "../project/project.dto";
import { downloadFile, streamToString, uploadFile } from "../../utils/S3Client";
import { findModelNameProblem, ProjectNameSchema } from "../../utils/names";
import { CreateModel } from "../model/model.dto";
import {
  authErrorResponse,
  getUserId,
  requireProjectOwner,
} from "../../utils/auth";

export async function GetDeployment(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      return ResponseManager.BadRequestResponse("Project Id must be valid");
    }

    await requireProjectOwner(projectId, getUserId(event));

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + projectId,
        },
      })
    );

    const projectItems = result.Items;

    if (!projectItems || projectItems.length < 1) {
      return ResponseManager.NotfoundResponse(
        "Project with id: " + projectId + " doesn't exist"
      );
    }

    let deployment = projectItems.find(
      (x) => x.entityType == Keys.DEPLOYMENT_TYPE
    ) as DeploymentModel;

    const project = projectItems.find(
      (x) => x.entityType == Keys.PROJECT_TYPE
    ) as ProjectModel;

    if (!deployment) {
      return ResponseManager.NotfoundResponse("Deployment doesn't exist");
    }

    const buildLogs = await FetchBuildLogs(
      deployment.buildId ? deployment.buildId : ""
    );

    let swaggerJson: string | undefined = undefined;
    let details:
      | { apiId: string | undefined; baseUrl: string | undefined }
      | undefined = undefined;

    if (
      buildLogs.build &&
      buildLogs.build.buildComplete &&
      buildLogs.build.buildStatus != deployment.buildStatus
    ) {
      if (buildLogs.build.buildStatus == StatusType.SUCCEEDED) {
        details = await fetchApiGatewayDetails(project.stackName ?? "", "prod");
      }

      const {
        updateExpression,
        expressionAttributeNames,
        expressionAttributeValues,
      } = getPutOperators({
        triggeredAt: deployment.triggeredAt,
        isDeploying: false,
        buildStatus: buildLogs.build.buildStatus,
        buildId: buildLogs.build.id,
        currentPhase: buildLogs.build.currentPhase,
        buildComplete: buildLogs.build.buildComplete,
        baseUrl: details?.baseUrl ? details?.baseUrl : "",
        apiId: details?.apiId ? details?.apiId : "",
      });

      await docClient.send(
        new UpdateCommand({
          TableName: process.env.SERVICE_TABLE ?? "",
          Key: { pk: deployment.pk, sk: deployment.sk },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );
    }

    if (deployment?.apiId) {
      const swagger = JSON.parse(
        await streamToString(
          await downloadFile(projectId + "/swagger-json.json")
        )
      );
      swagger.servers = [
        {
          url: deployment.baseUrl ? deployment.baseUrl : details?.baseUrl,
          description: "This is the prod server",
        },
      ];
      swagger.info.title = "API documentation for " + project.name;
      swagger.info.description = `
      This is showing the documentation for the latest deployment of ${project.name} project.
          - project description: ${project.description}
          - Last deployed at: ${deployment.deployedAt}
      `;
      swaggerJson = JSON.stringify(swagger);
    }

    const item: DeploymentResponseDto = {
      id: deployment.sk.split("_")[1],
      projectId: deployment.pk.split("_")[1],
      entityType: deployment.entityType,
      isDeploying: deployment.isDeploying,
      triggeredAt: new Date(deployment.triggeredAt),
      deployedAt: deployment.deployedAt
        ? new Date(deployment.deployedAt)
        : undefined,
      buildComplete: buildLogs.build
        ? buildLogs.build.buildComplete
        : deployment.buildComplete,
      buildId: deployment.buildId,
      buildStatus: buildLogs.build
        ? buildLogs.build.buildStatus
        : deployment.buildStatus,
      currentPhase: buildLogs.build
        ? buildLogs.build.currentPhase
        : deployment.currentPhase,
      log: buildLogs.logs,
      apiId: deployment.apiId ? deployment.apiId : details?.apiId,
      baseUrl: deployment.baseUrl ? deployment.baseUrl : details?.baseUrl,
      swaggerJson,
    };

    return ResponseManager.OkResponse(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(GetDeployment.name, error)
    );
  }
}

export async function TriggerDeployment(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<any> {
  try {
    const body = TriggerDeploymentDtoSchema.parse(
      JSON.parse(event.body || "{}") as TriggerDeploymentDto
    );

    await requireProjectOwner(body.projectId, getUserId(event));

    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SERVICE_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": Keys.PROJECT + body.projectId,
        },
      })
    );

    const project = result.Items;

    if (!project || project.length < 1) {
      return ResponseManager.NotfoundResponse(
        "Project with id: " + body.projectId + " doesn't exist"
      );
    }

    let deployment = project.find(
      (x) => x.entityType == Keys.DEPLOYMENT_TYPE
    ) as DeploymentModel;

    const theProject = project.find(
      (x) => x.entityType == Keys.PROJECT_TYPE
    ) as ProjectModel;

    // Rows saved before the name rules existed can hold names that are unsafe
    // to put in a build or in generated code.
    const nameProblem = findDeployNameProblem(
      theProject,
      project.filter((x) => x.entityType == Keys.MODEL_TYPE) as CreateModel[]
    );
    if (nameProblem) {
      return ResponseManager.BadRequestResponse(nameProblem, nameProblem);
    }

    const deploymentId = uuidv4();

    if (!deployment) {
      deployment = {
        pk: Keys.PROJECT + body.projectId,
        sk: Keys.DEPLOYMENT + deploymentId,
        entityType: Keys.DEPLOYMENT_TYPE,
        triggeredAt: new Date().toISOString(),
        isDeploying: false,
      };
    }

    if (deployment.isDeploying) {
      return ResponseManager.BadRequestResponse(
        "Deployment is already in progress!"
      );
    }

    deployment = {
      ...deployment,
      triggeredAt: new Date().toISOString(),
    };

    // First time deploying
    if (deployment.sk.includes(deploymentId)) {
      await docClient.send(
        new PutCommand({
          TableName: process.env.SERVICE_TABLE ?? "",
          Item: deployment,
        })
      );
    } else {
      const {
        updateExpression,
        expressionAttributeNames,
        expressionAttributeValues,
      } = getPutOperators({
        triggeredAt: deployment.triggeredAt,
      });

      await docClient.send(
        new UpdateCommand({
          TableName: process.env.SERVICE_TABLE ?? "",
          Key: { pk: deployment.pk, sk: deployment.sk },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );
    }

    const item: DeploymentResponseDto = {
      id: deployment.sk.split("_")[1],
      projectId: deployment.pk.split("_")[1],
      entityType: deployment.entityType,
      isDeploying: deployment.isDeploying,
      triggeredAt: new Date(deployment.triggeredAt),
      deployedAt: deployment.deployedAt
        ? new Date(deployment.deployedAt)
        : undefined,
      buildId: deployment.buildId,
    };

    await EventHub.Get().publish<DeploymentTriggeredPayload>({
      type: DEPLOYMENT_TRIGGERED,
      payload: {
        projectId: body.projectId,
        model: item,
        projectName: theProject.name,
      },
    });

    return ResponseManager.OkResponse(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ResponseManager.ValidationErrorResponse(error);
    }

    return (
      authErrorResponse(error) ??
      ResponseManager.InternalErrorResponse(TriggerDeployment.name, error)
    );
  }
}

function findDeployNameProblem(
  project: ProjectModel,
  models: CreateModel[]
): string | undefined {
  const projectName = ProjectNameSchema.safeParse(project.name);
  if (!projectName.success) {
    return `Rename the project before deploying: ${projectName.error.issues[0].message}`;
  }

  for (const model of models) {
    const problem = findModelNameProblem(model);
    if (problem) {
      return `Rename model "${model.name}" before deploying: ${problem}`;
    }
  }
  return undefined;
}
