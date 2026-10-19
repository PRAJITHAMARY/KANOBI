import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const { handled } = vi.hoisted(() => ({
  handled: [] as Array<{ name: string; payload: unknown }>,
}));

// Real handler modules do S3/codegen work; replace them with named recorders
// (LambdaEventHub derives Lambda function names from `handler.name`).
vi.mock("../../src/api/project/projectEvent", () => ({
  PROJECT_CREATED: "project created",
  PROJECT_DELETED: "project deleted",
  projectCreatedHandler: async function projectCreatedHandler(payload: unknown) {
    handled.push({ name: "projectCreatedHandler", payload });
    return "created";
  },
  projectDeletedHandler: async function projectDeletedHandler(payload: unknown) {
    handled.push({ name: "projectDeletedHandler", payload });
  },
}));

vi.mock("../../src/api/model/modelEvent", () => ({
  MODEL_CREATED: "model created",
  MODEL_DELETED: "model deleted",
  MODEL_UPDATED: "model upated",
  modelCreatedHandler: async function modelCreatedHandler(payload: unknown) {
    handled.push({ name: "modelCreatedHandler", payload });
  },
  modelDeletedHandler: async function modelDeletedHandler(payload: unknown) {
    handled.push({ name: "modelDeletedHandler", payload });
  },
  modelUpdatedHandler: async function modelUpdatedHandler() {
    throw new Error("update failed");
  },
}));

vi.mock("../../src/api/deployment/deploymentEvent", () => ({
  DEPLOYMENT_TRIGGERED: "deployment triggered",
  deploymentTriggeredHandler: async function deploymentTriggeredHandler(
    payload: unknown
  ) {
    handled.push({ name: "deploymentTriggeredHandler", payload });
  },
}));

import { EventHub, LambdaEventHub, LocalEventHub } from "../../src/utils/eventhub";

const lambda = mockClient(LambdaClient);

beforeEach(() => {
  handled.length = 0;
  lambda.reset();
});

describe("EventHub.Get", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the in-process hub in dev", () => {
    vi.stubEnv("NODE_ENV", "dev");
    expect(EventHub.Get()).toBeInstanceOf(LocalEventHub);
  });

  it("uses the Lambda hub elsewhere", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(EventHub.Get()).toBeInstanceOf(LambdaEventHub);
  });
});

describe("LocalEventHub", () => {
  const hub = new LocalEventHub();

  it.each([
    ["project created", "projectCreatedHandler"],
    ["project deleted", "projectDeletedHandler"],
    ["model created", "modelCreatedHandler"],
    ["model deleted", "modelDeletedHandler"],
    ["deployment triggered", "deploymentTriggeredHandler"],
  ])("routes '%s' to %s", async (type, name) => {
    await hub.publish({ type, payload: { id: 1 } });
    expect(handled).toEqual([{ name, payload: { id: 1 } }]);
  });

  it("resolves with the handler's result", async () => {
    await expect(
      hub.publish({ type: "project created", payload: {} })
    ).resolves.toBe("created");
  });

  it("echoes the payload for the default empty event", async () => {
    await expect(hub.publish({ type: "", payload: "ping" })).resolves.toBe("ping");
  });

  it("rejects unknown events", async () => {
    await expect(hub.publish({ type: "nope", payload: {} })).rejects.toBe(
      "nope Event handler not found"
    );
  });

  it("rejects with the event type when the handler throws", async () => {
    await expect(
      hub.publish({ type: "model upated", payload: {} })
    ).rejects.toBe("model upated Error: update failed");
  });
});

describe("LambdaEventHub", () => {
  const hub = new LambdaEventHub();

  it.each([
    ["project created", "projectCreatedHandler"],
    ["project deleted", "projectDeletedHandler"],
    ["model created", "modelCreatedHandler"],
    ["model deleted", "modelDeletedHandler"],
    ["model upated", "modelUpdatedHandler"],
    ["deployment triggered", "deploymentTriggeredHandler"],
  ])("invokes the Lambda for '%s' asynchronously", async (type, name) => {
    lambda.on(InvokeCommand).resolves({ StatusCode: 202 });

    await expect(hub.publish({ type, payload: { id: 1 } })).resolves.toBe(true);

    const [call] = lambda.commandCalls(InvokeCommand);
    expect(call.args[0].input).toEqual({
      FunctionName: `project-kanobi-test-${name}`,
      Payload: new TextEncoder().encode(JSON.stringify({ id: 1 })),
      InvocationType: "Event",
    });
  });

  it("uses the deploy region and the default credential chain (the Lambda role)", async () => {
    vi.stubEnv("AWS_KEY", "static-key");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "role-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "role-secret");
    lambda.on(InvokeCommand).resolves({});

    await new LambdaEventHub().publish({ type: "", payload: {} });

    const client = lambda.commandCalls(InvokeCommand)[0].thisValue as LambdaClient;
    expect(await client.config.region()).toBe("eu-west-1");
    expect(await client.config.credentials()).toMatchObject({ accessKeyId: "role-key" });
    vi.unstubAllEnvs();
  });

  it("returns true when FunctionError is missing", async () => {
    lambda.on(InvokeCommand).resolves({});
    await expect(hub.publish({ type: "", payload: {} })).resolves.toBe(true);
    expect(lambda.commandCalls(InvokeCommand)[0].args[0].input.FunctionName).toBe(
      "test-function-name"
    );
  });

  it("returns false when the invocation reports a FunctionError", async () => {
    lambda.on(InvokeCommand).resolves({ FunctionError: "Unhandled" });
    await expect(hub.publish({ type: "project created", payload: {} })).resolves.toBe(
      false
    );
  });

  it("throws for unknown events", async () => {
    await expect(hub.publish({ type: "nope", payload: {} })).rejects.toBe(
      "nope Event handler not found"
    );
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});
