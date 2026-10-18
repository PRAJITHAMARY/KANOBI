import { afterEach, describe, expect, it, vi } from "vitest";
import { infraClientConfig, isLocalStack } from "../../src/utils/awsConfig";

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

describe("infraClientConfig", () => {
  it("only sets the region for real AWS", () => {
    vi.stubEnv("DEPLOY_TARGET", undefined);
    vi.stubEnv("AWS_ENDPOINT", "http://localstack:4566");
    expect(infraClientConfig()).toEqual({ region: "eu-west-1" });
  });

  it("points at AWS_ENDPOINT with static credentials for LocalStack", () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    vi.stubEnv("AWS_ENDPOINT", "http://localstack:4566");
    expect(infraClientConfig()).toEqual({
      region: "eu-west-1",
      endpoint: "http://localstack:4566",
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    });
  });

  it("leaves the endpoint unset when AWS_ENDPOINT is missing", () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    vi.stubEnv("AWS_ENDPOINT", undefined);
    expect(infraClientConfig().endpoint).toBeUndefined();
  });
});
