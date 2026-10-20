import { Project } from "ts-morph";
import yaml from "js-yaml";
import { logError, logInfo } from "../../utils/logger";
import {
  copyFolder,
  deleteFolder,
  downloadFile,
  getSource,
  streamToString,
  uploadFile,
} from "../../utils/S3Client";
import { getPutOperators } from "../../utils/dynamodbHelpers";
import { docClient } from "../../utils/dynamodbClient";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Keys } from "../../utils/keys";
import {
  DeleteCloudFormationStack,
  getResourceName,
  getServiceName,
} from "../../utils/infraHelper";
import { deploymentRoleArn } from "../../utils/awsConfig";

export const PROJECT_CREATED = "project created";
export const PROJECT_DELETED = "project deleted";

export interface ProjectCreatedPayload {
  id: string;
  name: string;
  description?: string;
}

export interface ProjectDeletedPayload {
  id: string;
  stackName?: string;
}

export const projectCreatedHandler = async (payload: ProjectCreatedPayload) => {
  try {
    const newKeys = await copyFolder("boilerplate/", payload.id);
    const indexTempateKey = newKeys.find((x) => x.includes("indexTemplate.ts"));
    const yamlKey = newKeys.find((x) => x.includes("serverless.yml"));

    if (!indexTempateKey) {
      throw "No index template found";
    }

    if (!yamlKey) {
      throw "No serverless yml found";
    }

    await CreateIndexFile(indexTempateKey);
    await UpdateServiceAndStackName(yamlKey, payload);

    logInfo(projectCreatedHandler.name, "Created project!");
    return true;
  } catch (error) {
    logError(projectCreatedHandler.name, error);
  }
};

export const projectDeletedHandler = async (payload: ProjectDeletedPayload) => {
  try {
    await deleteFolder(payload.id);
    await DeleteCloudFormationStack(payload.stackName);

    logInfo(projectDeletedHandler.name, "Deleted project!");
    return true;
  } catch (error) {
    logError(projectDeletedHandler.name, error);
  }
};

async function UpdateServiceAndStackName(
  yamlKey: string,
  payload: ProjectCreatedPayload
) {
  const ymlData = await streamToString(await downloadFile(yamlKey));
  const doc = yaml.load(ymlData) as any;
  const environment = doc.provider.environment;

  const serviceName = getServiceName(payload.id);
  doc.service = serviceName;
  doc.provider.stackName = `${serviceName}-formation`;
  doc.provider.region = process.env.AWS_DEPLOY_REGION;
  // CloudFormation creates and deletes the service's resources with this role.
  const deploymentRole = deploymentRoleArn();
  if (deploymentRole) doc.provider.iam.deploymentRole = deploymentRole;
  environment["AWS_DEPLOY_REGION"] = process.env.AWS_DEPLOY_REGION;
  let resources = doc.resources.Resources;
  let statements = doc.provider.iam.role.statements;

  if (!resources) {
    resources = {};
    doc.resources.Resources = resources;
  }

  if (!statements) {
    statements = [];
    doc.provider.iam.role.statements = statements;
  }

  doc.provider.tags = {
    Service: serviceName,
    Project: payload.id,
  };

  doc.provider.stackTags = {
    Service: serviceName,
    Project: payload.id,
  };

  resources[getResourceName(payload.id) + "Files"] = {
    Type: "AWS::S3::Bucket",
    Properties: {
      BucketName: getResourceName(payload.id) + "-files",
      Tags: [
        {
          Key: "Service",
          Value: serviceName,
        },
        {
          Key: "Project",
          Value: payload.id,
        },
      ],
    },
  };

  const resource = statements.find((x: any) =>
    x.Action.includes("s3:PutObject")
  )?.Resource;

  if (resource) {
    resource.push(`arn:aws:s3:::${getResourceName(payload.id) + "-files"}`);
  } else {
    statements.push({
      Effect: "Allow",
      Action: [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:PutObjectAcl",
        "s3:GetObjectAcl",
        "s3:DeleteObjectVersion",
        "s3:ListBucketVersions",
      ],
      Resource: [
        `arn:aws:s3:::${getResourceName(payload.id) + "-files"}`,
        `arn:aws:s3:::${getResourceName(payload.id) + "-files"}/*`,
      ],
    });
  }

  await uploadFile(yamlKey, yaml.dump(doc));

  const {
    updateExpression,
    expressionAttributeNames,
    expressionAttributeValues,
  } = getPutOperators({
    stackName: `${serviceName}-formation`,
  });

  await docClient.send(
    new UpdateCommand({
      TableName: process.env.SERVICE_TABLE ?? "",
      Key: { pk: Keys.PROJECT + payload.id, sk: Keys.PROJECT + payload.id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

async function CreateIndexFile(indexTempateKey: string) {
  const sourceFile = await getSource(indexTempateKey);
  const indexKey = indexTempateKey.replace("indexTemplate", "index");
  const project = new Project({
    useInMemoryFileSystem: true,
  });

  const targetFile = project.createSourceFile(
    indexKey,
    "// This file is auto generated and should not be modified",
    { overwrite: true }
  );

  const importDecls = sourceFile.getImportDeclarations();

  for (const decl of importDecls) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    targetFile.addImportDeclaration({
      moduleSpecifier,
      defaultImport: decl.getDefaultImport()?.getText(),
      namespaceImport: decl.getNamespaceImport()?.getText(),
      namedImports: decl.getNamedImports().map((ni) => ni.getText()),
    });
  }

  await targetFile.save();
  await uploadFile(indexKey, targetFile.getFullText());
}
