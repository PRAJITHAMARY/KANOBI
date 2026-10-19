import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import yaml from "js-yaml";
import {
  boilerplateYaml,
  indexTemplateText,
  PROJECT_ID,
  sourceFileOf,
  streamOf,
} from "../helpers";

const s3 = vi.hoisted(() => ({
  copyFolder: vi.fn(),
  deleteFolder: vi.fn(),
  downloadFile: vi.fn(),
  getSource: vi.fn(),
  uploadFile: vi.fn(),
}));
const { deleteStack } = vi.hoisted(() => ({ deleteStack: vi.fn() }));

vi.mock("../../src/utils/S3Client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...s3,
}));
vi.mock("../../src/utils/infraHelper", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DeleteCloudFormationStack: deleteStack,
}));

import {
  projectCreatedHandler,
  projectDeletedHandler,
} from "../../src/api/project/projectEvent";

const ddb = mockClient(DynamoDBDocumentClient);

const uploaded = () =>
  Object.fromEntries(s3.uploadFile.mock.calls.map(([k, v]) => [k, v as string]));

const givenProjectFiles = (yml: string, template = indexTemplateText) => {
  s3.copyFolder.mockResolvedValue([
    `${PROJECT_ID}/package.json`,
    `${PROJECT_ID}/src/indexTemplate.ts`,
    `${PROJECT_ID}/serverless.yml`,
  ]);
  s3.getSource.mockImplementation(async (key: string) => sourceFileOf(key, template));
  s3.downloadFile.mockResolvedValue(streamOf(yml));
};

beforeEach(() => {
  ddb.reset();
  ddb.on(UpdateCommand).resolves({});
  Object.values(s3).forEach((fn) => fn.mockReset());
  s3.uploadFile.mockResolvedValue({});
  deleteStack.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("projectCreatedHandler", () => {
  it("copies the boilerplate, generates index.ts and configures serverless.yml", async () => {
    givenProjectFiles(boilerplateYaml);

    await expect(
      projectCreatedHandler({ id: PROJECT_ID, name: "Shop" })
    ).resolves.toBe(true);

    expect(s3.copyFolder).toHaveBeenCalledWith("boilerplate/", PROJECT_ID);
    expect(s3.getSource).toHaveBeenCalledWith(`${PROJECT_ID}/src/indexTemplate.ts`);

    const files = uploaded();
    const index = files[`${PROJECT_ID}/src/index.ts`];
    expect(index).toContain("// This file is auto generated and should not be modified");
    expect(index).toContain('import "reflect-metadata";');
    expect(index).toContain('import { docClient, getPutOperators } from "./utils/dynamodbClient";');
    expect(index).toContain('import { v4 as uuidv4 } from "uuid";');
    expect(index).not.toContain("function");

    const doc = yaml.load(files[`${PROJECT_ID}/serverless.yml`]) as any;
    expect(doc.service).toBe("service-555555");
    expect(doc.provider).toMatchObject({
      stackName: "service-555555-formation",
      region: "eu-west-1",
      environment: { AWS_DEPLOY_REGION: "eu-west-1" },
      tags: { Service: "service-555555", Project: PROJECT_ID },
      stackTags: { Service: "service-555555", Project: PROJECT_ID },
    });
    // CloudFormation creates and deletes the stack's resources with this role,
    // so neither CodeBuild nor the control plane needs those permissions.
    expect(doc.provider.iam.deploymentRole).toBe(
      "arn:aws:iam::123456789012:role/kanobi-cfn-execution-test"
    );
    const bucket = "11111111222233334444555555555555-files";
    expect(doc.resources.Resources["11111111222233334444555555555555Files"]).toMatchObject({
      Type: "AWS::S3::Bucket",
      Properties: { BucketName: bucket },
    });
    expect(doc.provider.iam.role.statements).toEqual([
      expect.objectContaining({
        Effect: "Allow",
        Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
      }),
    ]);

    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
      Key: { pk: `pr_${PROJECT_ID}`, sk: `pr_${PROJECT_ID}` },
      ExpressionAttributeValues: { ":stackName": "service-555555-formation" },
    });
  });

  it("leaves the deployment role out when deploying to LocalStack", async () => {
    vi.stubEnv("DEPLOY_TARGET", "localstack");
    vi.stubEnv("CFN_EXECUTION_ROLE_ARN", undefined);
    givenProjectFiles(boilerplateYaml);

    await expect(projectCreatedHandler({ id: PROJECT_ID, name: "shop" })).resolves.toBe(true);

    const doc = yaml.load(uploaded()[`${PROJECT_ID}/serverless.yml`]) as any;
    expect(doc.provider.iam.deploymentRole).toBeUndefined();
  });

  it("fails without CFN_EXECUTION_ROLE_ARN on AWS", async () => {
    vi.stubEnv("CFN_EXECUTION_ROLE_ARN", undefined);
    givenProjectFiles(boilerplateYaml);

    await expect(projectCreatedHandler({ id: PROJECT_ID, name: "shop" })).resolves.toBeUndefined();

    expect(uploaded()[`${PROJECT_ID}/serverless.yml`]).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      "[ERROR]: ",
      "PROJECTCREATEDHANDLER",
      new Error("CFN_EXECUTION_ROLE_ARN is not set")
    );
  });

  it("extends existing resources and S3 statements", async () => {
    givenProjectFiles(
      yaml.dump({
        provider: {
          environment: {},
          iam: {
            role: {
              statements: [
                { Effect: "Allow", Action: ["dynamodb:PutItem"], Resource: [] },
                { Effect: "Allow", Action: ["s3:PutObject"], Resource: ["arn:existing"] },
              ],
            },
          },
        },
        resources: { Resources: { Existing: { Type: "X" } } },
      }),
      [
        'import Default from "a";',
        'import * as ns from "b";',
        'import Other, { named } from "c";',
      ].join("\n")
    );

    await projectCreatedHandler({ id: PROJECT_ID, name: "Shop" });

    const files = uploaded();
    const doc = yaml.load(files[`${PROJECT_ID}/serverless.yml`]) as any;
    expect(Object.keys(doc.resources.Resources)).toEqual([
      "Existing",
      "11111111222233334444555555555555Files",
    ]);
    expect(doc.provider.iam.role.statements[1].Resource).toEqual([
      "arn:existing",
      "arn:aws:s3:::11111111222233334444555555555555-files",
    ]);

    const index = files[`${PROJECT_ID}/src/index.ts`];
    expect(index).toContain('import Default from "a";');
    expect(index).toContain('import * as ns from "b";');
    expect(index).toContain('import Other, { named } from "c";');
  });

  it("falls back to an empty table name when SERVICE_TABLE is unset", async () => {
    vi.stubEnv("SERVICE_TABLE", undefined);
    givenProjectFiles(boilerplateYaml);

    await projectCreatedHandler({ id: PROJECT_ID, name: "Shop" });

    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.TableName).toBe("");
  });

  it.each([
    ["index template", [`${PROJECT_ID}/serverless.yml`]],
    ["serverless.yml", [`${PROJECT_ID}/src/indexTemplate.ts`]],
  ])("logs and gives up when the %s is missing", async (_label, keys) => {
    s3.copyFolder.mockResolvedValue(keys);

    await expect(projectCreatedHandler({ id: PROJECT_ID, name: "Shop" })).resolves.toBeUndefined();

    expect(s3.uploadFile).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("projectDeletedHandler", () => {
  it("removes the project's files and stack", async () => {
    s3.deleteFolder.mockResolvedValue(undefined);

    await expect(
      projectDeletedHandler({ id: "p1", stackName: "stack" })
    ).resolves.toBe(true);

    expect(s3.deleteFolder).toHaveBeenCalledWith("p1");
    expect(deleteStack).toHaveBeenCalledWith("stack");
  });

  it("logs errors", async () => {
    s3.deleteFolder.mockRejectedValue(new Error("x"));
    await expect(projectDeletedHandler({ id: "p1" })).resolves.toBeUndefined();
    expect(deleteStack).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});
