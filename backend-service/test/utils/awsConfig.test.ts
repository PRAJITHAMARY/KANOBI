import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deploymentRoleArn,
  infraClientConfig,
  isLocalStack,
  LOCAL_CREDENTIALS,
  localEndpointConfig,
} from "../../src/utils/awsConfig";

afterEach(() => vi.unstubAllEnvs());

describe("isLocalStack", () => {
  it.each([
    [undefined, false],
    ["aws", false],
    ["localstack", true],
  ])("DEPLOY_TARGET=%s -> %s", (target, expected) => {
    vi.stubEnv("DEPLOY_TARGET", target);
    expect(isLocalStack()).toBe(expected);
  });
});

describe("localEndpointConfig", () => {
  it("adds dummy credentials to a local endpoint", () => {
    expect(localEndpointConfig("http://localhost:4566")).toEqual({
      endpoint: "http://localhost:4566",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
  });

  it("adds nothing without an endpoint, so the default credential chain applies", () => {
    expect(localEndpointConfig(undefined)).toEqual({});
    expect(localEndpointConfig("")).toEqual({});
  });
});

describe("infraClientConfig", () => {
  it("only sets the region for real AWS, so the execution role is used", () => {
    vi.stubEnv("DEPLOY_TARGET", undefined);
    vi.stubEnv("AWS_ENDPOINT", "http://localstack:4566");
    expect(infraClientConfig()).toEqual({ region: "eu-west-1" });
  });

  it("points at AWS_ENDPOINT with dummy credentials for LocalStack", () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    vi.stubEnv("AWS_ENDPOINT", "http://localstack:4566");
    // Static keys from the old configuration must never be picked up.
    vi.stubEnv("AWS_KEY", "real-key");
    vi.stubEnv("AWS_SECRET", "real-secret");
    expect(infraClientConfig()).toEqual({
      region: "eu-west-1",
      endpoint: "http://localstack:4566",
      credentials: LOCAL_CREDENTIALS,
    });
  });

  it("leaves the endpoint unset when AWS_ENDPOINT is missing", () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    vi.stubEnv("AWS_ENDPOINT", undefined);
    expect(infraClientConfig()).toEqual({ region: "eu-west-1" });
  });
});

describe("deploymentRoleArn", () => {
  it("returns the CloudFormation execution role on AWS", () => {
    expect(deploymentRoleArn()).toBe("arn:aws:iam::123456789012:role/kanobi-cfn-execution-test");
  });

  it("throws when the role is not configured", () => {
    vi.stubEnv("CFN_EXECUTION_ROLE_ARN", undefined);
    expect(() => deploymentRoleArn()).toThrow("CFN_EXECUTION_ROLE_ARN is not set");
  });

  it("is not used on LocalStack", () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    vi.stubEnv("CFN_EXECUTION_ROLE_ARN", undefined);
    expect(deploymentRoleArn()).toBeUndefined();
  });
});
