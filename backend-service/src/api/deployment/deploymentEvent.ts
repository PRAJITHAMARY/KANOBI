import { logError, logInfo } from "../../utils/logger";
import {
  downloadFile,
  listFolder,
  readStreamToBuffer,
  uploadFile,
} from "../../utils/S3Client";
import { DeploymentResponseDto } from "./deployment.dto";
import { join, dirname } from "path";
import { mkdirSync, createWriteStream, existsSync, rmSync } from "fs";
import archiver from "archiver";
import { docClient } from "../../utils/dynamodbClient";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getPutOperators } from "../../utils/dynamodbHelpers";
import { Keys } from "../../utils/keys";
import { CodeBuild } from "aws-sdk";
import { isLocalStack } from "../../utils/awsConfig";
import { startLocalBuild } from "../../utils/localBuildRunner";

export const DEPLOYMENT_TRIGGERED = "deployment triggered";

export interface DeploymentTriggeredPayload {
  projectId: string | undefined;
  model: DeploymentResponseDto;
  projectName: string;
}

export const deploymentTriggeredHandler = async (
  payload: DeploymentTriggeredPayload
) => {
  const projectFolder = payload.projectId;
  const deployment = payload.model;

  if (!projectFolder) {
    throw "invalid project folder";
  }

  const downloadPath = await downloadSourceCode(projectFolder);

  const cwd = join(downloadPath, projectFolder);
  const localZipPath = join(downloadPath, projectFolder + ".zip");
  const zipKey = projectFolder + ".zip";

  const response = await zipFolder(cwd, localZipPath);
  // zipFolder currently resolves true or rejects; keep the guard in case that changes.
  /* v8 ignore if -- @preserve */
  if (!response) {
    logError(deploymentTriggeredHandler.name, "Failed to Zip artifact");
    throw "Failed to Zip artifact";
  }

  const bufffer = await readStreamToBuffer(localZipPath);
  const uploadRes = await uploadFile(zipKey, bufffer);

  if (!uploadRes) {
    logError(deploymentTriggeredHandler.name, "Failed to upload Zip");
    throw "Failed to upload Zip";
  }

  const buildResult = isLocalStack()
    ? await startLocalBuild(cwd, projectFolder, payload.projectName)
    : await TriggerBuild(zipKey, projectFolder, payload.projectName);

  const op = getPutOperators({
    isDeploying: true,
    deployedAt: new Date().toISOString(),
    buildStatus: buildResult.build?.buildStatus,
    buildId: buildResult.build?.id,
    currentPhase: buildResult.build?.currentPhase,
    buildComplete: buildResult.build?.buildComplete,
  });

  await docClient.send(
    new UpdateCommand({
      TableName: process.env.SERVICE_TABLE ?? "",
      Key: {
        pk: Keys.PROJECT + projectFolder,
        sk: Keys.DEPLOYMENT + deployment.id,
      },
      UpdateExpression: op.updateExpression,
      ExpressionAttributeNames: op.expressionAttributeNames,
      ExpressionAttributeValues: op.expressionAttributeValues,
    })
  );

  logInfo(deploymentTriggeredHandler.name, "Deployment complete!");
};

async function TriggerBuild(
  zipKey: string,
  projectFolder: string,
  projectName: string
) {
  const buildParams = {
    projectName: "sls-code-deploy",
    sourceTypeOverride: "S3",
    sourceLocationOverride: `${process.env.BUCKET_NAME}/${zipKey}`,
    buildspecOverride: `
version: 0.2

env:
  variables:
    AWS_ACCESS_KEY_ID: ${process.env.AWS_KEY}
    AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET}
    AWS_REGION: ${process.env.AWS_DEPLOY_REGION}

phases:
  install:
    runtime-versions:
      nodejs: 18
    commands:
      - npm install -g serverless@3
      - npm install -g typescript
  build:
    commands:
      - npm install
      - npm i --save-dev @types/node
      - npm run build && node ./docs.js -p ${projectName}
      - aws s3 cp ./dist/swagger-json.json s3://${process.env.BUCKET_NAME}/${projectFolder}/swagger-json.json
      - sls deploy --stage prod
    `,
  };

  const codebuild = new CodeBuild({
    region: process.env.AWS_DEPLOY_REGION,
    credentials: {
      accessKeyId: `${process.env.AWS_KEY}`,
      secretAccessKey: `${process.env.AWS_SECRET}`,
    },
  });

  const result = await codebuild.startBuild(buildParams).promise();
  return result;
}

async function zipFolder(sourceDir: string, outPath: string) {
  const output = createWriteStream(outPath);
  const archive = archiver("zip", {
    zlib: { level: 9 }, // best compression
  });

  return new Promise((resolve, reject) => {
    output.on("close", () => {
      logInfo(
        deploymentTriggeredHandler.name,
        `✅ Zipped ${sourceDir} -> ${outPath} (${archive.pointer()} bytes)`
      );
      resolve(true);
    });

    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function downloadSourceCode(projectFolder: string) {
  logInfo(deploymentTriggeredHandler.name, "Downloading files from s3");

  const downloadPath = join(
    process.env.NODE_ENV == "dev" ? process.cwd() : "/tmp",
    ".downloads"
  );

  if (!existsSync(downloadPath)) {
    logInfo(deploymentTriggeredHandler.name, "Creating download path");
    mkdirSync(downloadPath);
  }

  // The local build runs in place, so start from a clean copy of the project.
  if (isLocalStack()) {
    rmSync(join(downloadPath, projectFolder), { recursive: true, force: true });
  }

  const files = await listFolder(projectFolder);
  for (let file of files) {
    if (!file.Key) {
      continue;
    }

    const localFilePath = join(downloadPath, file.Key);
    if (!existsSync(dirname(localFilePath))) {
      logInfo(
        deploymentTriggeredHandler.name,
        "Creating download file path" + dirname(localFilePath)
      );

      mkdirSync(dirname(localFilePath), { recursive: true });
    }

    const fileStream = createWriteStream(localFilePath);
    const s3Stream = await downloadFile(file.Key);

    if (!s3Stream) {
      continue;
    }

    await new Promise((resolve, reject) => {
      s3Stream
        .pipe(fileStream)
        .on("error", (err) => {
          logError(
            deploymentTriggeredHandler.name,
            "Error downloading file: " + file.Key
          );

          logError(deploymentTriggeredHandler.name, err);
          reject(err);
        })
        .on("close", () => {
          logInfo(
            deploymentTriggeredHandler.name,
            "Downloaded file: " + file.Key
          );

          resolve(true);
        });
    });
  }

  return downloadPath;
}
