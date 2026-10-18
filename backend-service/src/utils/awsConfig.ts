// DEPLOY_TARGET=localstack points the infrastructure clients (CloudFormation,
// API Gateway, CodeBuild) at AWS_ENDPOINT and swaps CodeBuild for the local
// build runner. Used by the Docker test environment (see docker-compose.yml).
export const isLocalStack = () => process.env.DEPLOY_TARGET === "localstack";

export const infraClientConfig = () => {
  if (!isLocalStack()) {
    return { region: process.env.AWS_DEPLOY_REGION };
  }

  return {
    region: process.env.AWS_DEPLOY_REGION,
    endpoint: process.env.AWS_ENDPOINT,
    credentials: {
      accessKeyId: `${process.env.AWS_KEY}`,
      secretAccessKey: `${process.env.AWS_SECRET}`,
    },
  };
};
