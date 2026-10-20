// AWS clients never get explicit credentials on AWS: the SDK's default chain
// resolves the Lambda execution role (or a developer's profile locally).
//
// DEPLOY_TARGET=localstack points the infrastructure clients (CloudFormation,
// API Gateway, CloudWatch Logs) at AWS_ENDPOINT and swaps CodeBuild for the
// local build runner. Used by the Docker test environment (see docker-compose.yml).
export const isLocalStack = () => process.env.DEPLOY_TARGET === "localstack";

// Local emulators (LocalStack, DynamoDB Local) accept any credentials.
export const LOCAL_CREDENTIALS = { accessKeyId: "test", secretAccessKey: "test" };

/** Endpoint override plus dummy credentials, or nothing when there is no endpoint. */
export const localEndpointConfig = (endpoint: string | undefined) =>
  endpoint ? { endpoint, credentials: LOCAL_CREDENTIALS } : {};

export const infraClientConfig = () => ({
  region: process.env.AWS_DEPLOY_REGION,
  ...(isLocalStack() ? localEndpointConfig(process.env.AWS_ENDPOINT) : {}),
});

/**
 * The role CloudFormation uses to create and delete generated services'
 * resources. Not used on LocalStack.
 */
export const deploymentRoleArn = (): string | undefined => {
  if (isLocalStack()) return undefined;
  const arn = process.env.CFN_EXECUTION_ROLE_ARN;
  if (!arn) throw new Error("CFN_EXECUTION_ROLE_ARN is not set");
  return arn;
};
