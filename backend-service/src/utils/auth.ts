import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";
import { docClient } from "./dynamodbClient";
import { Keys } from "./keys";
import { ResponseManager } from "./responseManager";

// API Gateway's Cognito authorizer (and the local dev server) verifies the ID
// token and passes its claims in requestContext.authorizer.claims.

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class ProjectNotFoundError extends Error {
  constructor(projectId: string | undefined) {
    super("Project with id: " + projectId + " Not found");
  }
}

/** The signed-in user's id (the token's `sub`). */
export const getUserId = (event: APIGatewayProxyEvent): string => {
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (typeof sub !== "string" || !sub) throw new UnauthorizedError();
  return sub;
};

/**
 * Loads the project row and checks that the user owns it. A project owned by
 * someone else is reported as not found, so ids can't be probed.
 */
export const requireProjectOwner = async (
  projectId: string | undefined,
  userId: string
) => {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: process.env.SERVICE_TABLE ?? "",
      Key: { pk: Keys.PROJECT + projectId, sk: Keys.PROJECT + projectId },
    })
  );

  if (!Item || Item.ownerId !== userId) {
    throw new ProjectNotFoundError(projectId);
  }
  return Item;
};

/** The response for an auth or ownership failure, or undefined for other errors. */
export const authErrorResponse = (error: unknown) => {
  if (error instanceof UnauthorizedError) {
    return ResponseManager.AuthFailedResponse(error.message);
  }
  if (error instanceof ProjectNotFoundError) {
    return ResponseManager.NotfoundResponse(error.message);
  }
  return undefined;
};
