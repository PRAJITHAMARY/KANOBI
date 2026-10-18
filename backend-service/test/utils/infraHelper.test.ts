import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BatchGetBuildsCommand,
  CodeBuildClient,
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
import {
  APIGatewayClient,
  GetExportCommand,
} from "@aws-sdk/client-api-gateway";
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";
import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DeleteCloudFormationStack,
  exportSwagger,
  fetchApiGatewayDetails,
  FetchBuildLogs,
  getResourceName,
  getServiceName,
  getStackCurrentCost,
  getStackMonthlyCost,
} from "../../src/utils/infraHelper";
import { PROJECT_ID } from "../helpers";

const local = vi.hoisted(() => ({ getLocalBuild: vi.fn() }));
vi.mock("../../src/utils/localBuildRunner", () => local);

const codebuild = mockClient(CodeBuildClient);
const logs = mockClient(CloudWatchLogsClient);
const cfn = mockClient(CloudFormationClient);
const apiGw = mockClient(APIGatewayClient);
const cost = mockClient(CostExplorerClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  codebuild.reset();
  logs.reset();
  cfn.reset();
  apiGw.reset();
  cost.reset();
  s3.reset();
  local.getLocalBuild.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("getResourceName / getServiceName", () => {
  it("strips dashes and tolerates a missing id", () => {
    expect(getResourceName("a-b-c")).toBe("abc");
    expect(getResourceName(undefined)).toBe("");
  });

  it("derives the generated service name from the id suffix", () => {
    expect(getServiceName(PROJECT_ID)).toBe("service-555555");
  });
});

describe("DeleteCloudFormationStack", () => {
  it("does nothing without a stack name", async () => {
    await DeleteCloudFormationStack(undefined);
    expect(cfn.calls()).toHaveLength(0);
  });

  it("empties the stack's buckets before deleting it", async () => {
    cfn.on(DescribeStackResourcesCommand).resolves({
      StackResources: [
        {
          ResourceType: "AWS::S3::Bucket",
          PhysicalResourceId: "bucket-1",
        } as any,
        { ResourceType: "AWS::Lambda::Function", PhysicalResourceId: "fn" } as any,
      ],
    });
    s3.on(ListObjectVersionsCommand).resolves({ IsTruncated: false });

    await DeleteCloudFormationStack("stack");

    expect(s3.commandCalls(ListObjectVersionsCommand)[0].args[0].input.Bucket).toBe(
      "bucket-1"
    );
    expect(cfn.commandCalls(DeleteStackCommand)[0].args[0].input).toEqual({
      StackName: "stack",
    });
  });

  it("deletes a stack that has no resources listed", async () => {
    cfn.on(DescribeStackResourcesCommand).resolves({});
    await DeleteCloudFormationStack("stack");
    expect(s3.calls()).toHaveLength(0);
    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(1);
  });

  it("logs and swallows errors", async () => {
    cfn.on(DescribeStackResourcesCommand).rejects(new Error("nope"));
    await expect(DeleteCloudFormationStack("stack")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("FetchBuildLogs", () => {
  it("returns a placeholder for an empty build id", async () => {
    expect(await FetchBuildLogs("")).toEqual({ build: null, logs: "No logs found" });
  });

  it("returns a placeholder when no builds are returned", async () => {
    codebuild.on(BatchGetBuildsCommand).resolvesOnce({}).resolvesOnce({ builds: [] });
    expect(await FetchBuildLogs("b1")).toEqual({ build: null, logs: "No logs found" });
    expect(await FetchBuildLogs("b1")).toEqual({ build: null, logs: "No logs found" });
  });

  it.each([
    [undefined],
    [{ streamName: "s" }],
    [{ groupName: "g" }],
  ])("reports missing log location %#", async (buildLogs) => {
    codebuild.on(BatchGetBuildsCommand).resolves({
      builds: [{ id: "b1", logs: buildLogs }],
    });
    expect(await FetchBuildLogs("b1")).toEqual({
      build: null,
      logs: "No log group name or log stream name found",
    });
  });

  it("pages through log events until an empty page", async () => {
    const build = { id: "b1", logs: { groupName: "g", streamName: "s" } };
    codebuild.on(BatchGetBuildsCommand).resolves({ builds: [build] });
    logs
      .on(GetLogEventsCommand)
      .resolvesOnce({
        events: [{ message: "one" }, { message: "two" }],
        nextForwardToken: "t1",
      })
      .resolvesOnce({ events: [{ message: "three" }], nextForwardToken: "t2" })
      .resolvesOnce({ events: [], nextForwardToken: "t3" });

    const result = await FetchBuildLogs("b1");

    expect(result).toEqual({ build, logs: "one\ntwo\nthree" });
    const calls = logs.commandCalls(GetLogEventsCommand);
    expect(calls).toHaveLength(3);
    expect(calls[0].args[0].input).toEqual({
      logGroupName: "g",
      logStreamName: "s",
      nextToken: undefined,
      startFromHead: true,
    });
    expect(calls[1].args[0].input.nextToken).toBe("t1");
  });

  it("stops when there is no next token", async () => {
    const build = { id: "b1", logs: { groupName: "g", streamName: "s" } };
    codebuild.on(BatchGetBuildsCommand).resolves({ builds: [build] });
    logs.on(GetLogEventsCommand).resolves({ events: [{ message: "only" }] });

    expect(await FetchBuildLogs("b1")).toEqual({ build, logs: "only" });
  });

  it("reads local builds instead of CodeBuild when targeting LocalStack", async () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    const localBuild = { build: { id: "local:1", buildStatus: "SUCCEEDED" }, logs: "done" };
    local.getLocalBuild.mockResolvedValue(localBuild);

    expect(await FetchBuildLogs("local:1")).toEqual(localBuild);
    expect(local.getLocalBuild).toHaveBeenCalledWith("local:1");
    expect(codebuild.calls()).toHaveLength(0);
  });

  it("returns a failure placeholder when a local build can't be read", async () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    local.getLocalBuild.mockRejectedValue(new SyntaxError("bad json"));
    expect(await FetchBuildLogs("local:1")).toEqual({
      build: null,
      logs: "Failed to fetch logs",
    });
  });

  it("returns a failure placeholder on error", async () => {
    codebuild.on(BatchGetBuildsCommand).rejects(new Error("x"));
    expect(await FetchBuildLogs("b1")).toEqual({
      build: null,
      logs: "Failed to fetch logs",
    });
  });
});

describe("fetchApiGatewayDetails", () => {
  it("extracts the api id from the ServiceEndpoint output", async () => {
    cfn.on(DescribeStacksCommand).resolves({
      Stacks: [
        { Outputs: undefined } as any,
        {
          Outputs: [
            { OutputKey: "Other", OutputValue: "x" },
            {
              OutputKey: "ServiceEndpoint",
              OutputValue: "https://abc123.execute-api.eu-west-1.amazonaws.com/prod",
            },
          ],
        } as any,
      ],
    });

    expect(await fetchApiGatewayDetails("stack", "prod")).toEqual({
      apiId: "abc123",
      baseUrl: "https://abc123.execute-api.eu-west-1.amazonaws.com/prod",
    });
  });

  it("handles a ServiceEndpoint output without a value", async () => {
    cfn.on(DescribeStacksCommand).resolves({
      Stacks: [{ Outputs: [{ OutputKey: "ServiceEndpoint" }] } as any],
    });
    expect(await fetchApiGatewayDetails("stack", "prod")).toEqual({
      apiId: undefined,
      baseUrl: undefined,
    });
  });

  it("throws when there is no ServiceEndpoint", async () => {
    cfn.on(DescribeStacksCommand).resolves({});
    await expect(fetchApiGatewayDetails("stack", "prod")).rejects.toThrow(
      "ServiceEndpoint not found in stack outputs."
    );
  });
});

describe("exportSwagger", () => {
  it("returns the exported swagger body", async () => {
    apiGw.on(GetExportCommand).resolves({
      body: { transformToString: () => '{"swagger":"2.0"}' } as any,
    });
    expect(await exportSwagger("api", "prod")).toBe('{"swagger":"2.0"}');
    expect(apiGw.commandCalls(GetExportCommand)[0].args[0].input).toMatchObject({
      restApiId: "api",
      stageName: "prod",
      exportType: "swagger",
    });
  });

  it("returns undefined without a body", async () => {
    apiGw.on(GetExportCommand).resolves({});
    expect(await exportSwagger("api", "prod")).toBeUndefined();
  });
});

describe.each([
  ["getStackCurrentCost", getStackCurrentCost, "2026-03-15"],
  ["getStackMonthlyCost", getStackMonthlyCost, "2026-04-01"],
])("%s", (_name, fn, expectedEnd) => {
  afterEach(() => vi.useRealTimers());

  it("returns the cost for the matching tag group", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 15, 12));
    cost.on(GetCostAndUsageCommand).resolves({
      ResultsByTime: [
        {
          Groups: [
            { Keys: ["/Project/other"] },
            {
              Keys: ["/Project/p1"],
              Metrics: { UnblendedCost: { Amount: "1.2345", Unit: "EUR" } },
            },
          ],
        },
      ],
    });

    expect(await fn("Project", "p1")).toEqual({
      tagKey: "Project",
      tagValue: "p1",
      amount: "1.23",
      currency: "EUR",
    });
    const input = cost.commandCalls(GetCostAndUsageCommand)[0].args[0].input;
    expect(input.GroupBy).toEqual([{ Type: "TAG", Key: "Project" }]);
    expect(input.TimePeriod).toEqual({ Start: "2026-03-01", End: expectedEnd });
  });

  it("returns zero without calling Cost Explorer when targeting LocalStack", async () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    expect(await fn("Project", "p1")).toEqual({
      tagKey: "Project",
      tagValue: "p1",
      amount: "0.00",
      currency: "USD",
    });
    expect(cost.calls()).toHaveLength(0);
  });

  it("defaults to zero USD when nothing matches", async () => {
    cost
      .on(GetCostAndUsageCommand)
      .resolvesOnce({})
      .resolvesOnce({
        ResultsByTime: [{ Groups: [{ Keys: undefined }, { Keys: ["/Project/p1"] }] }],
      });

    const expected = { tagKey: "Project", tagValue: "p1", amount: "0.00", currency: "USD" };
    expect(await fn("Project", "p1")).toEqual(expected);
    expect(await fn("Project", "p1")).toEqual(expected);
  });
});
