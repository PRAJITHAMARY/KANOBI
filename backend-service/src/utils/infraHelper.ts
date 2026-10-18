import {
  CodeBuildClient,
  BatchGetBuildsCommand,
  Build,
} from "@aws-sdk/client-codebuild";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { logError, logInfo } from "./logger";
import {
  APIGatewayClient,
  GetExportCommand,
} from "@aws-sdk/client-api-gateway";
import { emptyBucket } from "./S3Client";
import { infraClientConfig, isLocalStack } from "./awsConfig";
import { getLocalBuild } from "./localBuildRunner";
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";

const codebuild = new CodeBuildClient(infraClientConfig());

const cloudWatchLogs = new CloudWatchLogsClient(infraClientConfig());

const apiGwClient = new APIGatewayClient(infraClientConfig());

const cloudFormation = new CloudFormationClient(infraClientConfig());

const costClient = new CostExplorerClient({
  region: process.env.AWS_DEPLOY_REGION,
});

export const getResourceName = (projectId: string | undefined) => {
  if (!projectId) projectId = ""; //Todo: we might want to generate a unique Id here
  return projectId.replace(/-/g, "");
};

export async function DeleteCloudFormationStack(stackName: string | undefined) {
  try {
    if (!stackName) {
      return;
    }

    const stackResp = await cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: stackName,
      })
    );

    const bucketResources =
      stackResp.StackResources?.filter(
        (res) => res.ResourceType === "AWS::S3::Bucket"
      )?.map((x) => x.PhysicalResourceId!) || [];

    for (const bucket of bucketResources) {
      await emptyBucket(bucket);
    }

    await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));

    logInfo(
      DeleteCloudFormationStack.name,
      `Deletion initiated for stack: ${stackName}`
    );
  } catch (err) {
    logError(DeleteCloudFormationStack.name, err);
  }
}

export async function FetchBuildLogs(buildId: string): Promise<{
  build: Build | null;
  logs: string;
}> {
  try {
    if (!buildId) {
      return {
        build: null,
        logs: "No logs found",
      };
    }

    if (isLocalStack()) {
      return await getLocalBuild(buildId);
    }

    const buildData = await codebuild.send(
      new BatchGetBuildsCommand({ ids: [buildId] })
    );

    if (!buildData.builds || buildData.builds.length === 0) {
      return {
        build: null,
        logs: "No logs found",
      };
    }

    const build = buildData.builds[0];

    if (!build.logs || !build.logs.groupName || !build.logs.streamName) {
      return {
        build: null,
        logs: "No log group name or log stream name found",
      };
    }

    const { groupName, streamName } = build.logs;

    let nextToken;
    let allMessages = [];

    do {
      logInfo(FetchBuildLogs.name, "Fetching logs");
      const response: any = await cloudWatchLogs.send(
        new GetLogEventsCommand({
          logGroupName: groupName,
          logStreamName: streamName,
          nextToken,
          startFromHead: true,
        })
      );

      const messages = response.events.map((e: any) => e.message);
      if (messages.length < 1) {
        break;
      }

      allMessages.push(...messages);
      nextToken = response.nextForwardToken;
    } while (nextToken);

    return {
      build,
      logs: allMessages.join("\n"),
    };
  } catch (err) {
    logError(FetchBuildLogs.name, err);

    return {
      build: null,
      logs: "Failed to fetch logs",
    };
  }
}

export async function fetchApiGatewayDetails(stackName: string, stage: string) {
  const stackResp = await cloudFormation.send(
    new DescribeStacksCommand({
      StackName: stackName,
    })
  );

  const outputs = stackResp.Stacks?.flatMap((x) => x.Outputs).filter(
    (x) => x != undefined || x != null
  );

  const apiIdOutput = outputs?.find((o) => o?.OutputKey === "ServiceEndpoint");

  if (!apiIdOutput) {
    throw new Error("ServiceEndpoint not found in stack outputs.");
  }

  const serviceEndpoint = apiIdOutput.OutputValue;
  const apiId = serviceEndpoint?.split(".")[0].substring(8);

  return { apiId, baseUrl: serviceEndpoint };
}

export async function exportSwagger(apiId: string, stageName: string) {
  const command = new GetExportCommand({
    restApiId: apiId,
    stageName,
    exportType: "swagger",
    parameters: {
      extensions: "integrations",
    },
    accepts: "application/json",
  });

  const response = await apiGwClient.send(command);
  const body = response.body?.transformToString();

  return body;
}

export function getServiceName(projectId: string) {
  const serviceName = `service-${getResourceName(projectId)
    .substring(26)
    .toUpperCase()}`;

  return serviceName;
}

// Cost Explorer isn't available in LocalStack, so local projects cost nothing.
const localCost = (tagKey: string, tagValue: string) => ({
  tagKey,
  tagValue,
  amount: "0.00",
  currency: "USD",
});

export async function getStackCurrentCost(tagKey: string, tagValue: string) {
  if (isLocalStack()) return localCost(tagKey, tagValue);

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);

  const formatDate = (d: Date) => d.toISOString().split("T")[0];

  const command = new GetCostAndUsageCommand({
    TimePeriod: {
      Start: formatDate(start),
      End: formatDate(today),
    },
    Granularity: "MONTHLY",
    Metrics: ["UnblendedCost"],
    GroupBy: [
      {
        Type: "TAG",
        Key: tagKey,
      },
    ],
  });

  const response = await costClient.send(command);

  const results = response.ResultsByTime?.[0]?.Groups || [];
  const stackGroup = results.find(
    (g) => g.Keys?.[0] === `/${tagKey}/${tagValue}`
  );

  const amount = stackGroup?.Metrics?.UnblendedCost?.Amount || "0.0";

  return {
    tagKey,
    tagValue,
    amount: parseFloat(amount).toFixed(2),
    currency: stackGroup?.Metrics?.UnblendedCost?.Unit || "USD",
  };
}

export async function getStackMonthlyCost(tagKey: string, tagValue: string) {
  if (isLocalStack()) return localCost(tagKey, tagValue);

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const formatDate = (d: Date) => d.toISOString().split("T")[0];

  const command = new GetCostAndUsageCommand({
    TimePeriod: {
      Start: formatDate(start),
      End: formatDate(end),
    },
    Granularity: "MONTHLY",
    Metrics: ["UnblendedCost"],
    GroupBy: [
      {
        Type: "TAG",
        Key: tagKey,
      },
    ],
  });

  const response = await costClient.send(command);

  const results = response.ResultsByTime?.[0]?.Groups || [];
  const stackGroup = results.find(
    (g) => g.Keys?.[0] === `/${tagKey}/${tagValue}`
  );

  const amount = stackGroup?.Metrics?.UnblendedCost?.Amount || "0.0";

  return {
    tagKey,
    tagValue,
    amount: parseFloat(amount).toFixed(2),
    currency: stackGroup?.Metrics?.UnblendedCost?.Unit || "USD",
  };
}
