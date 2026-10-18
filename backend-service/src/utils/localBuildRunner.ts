import { spawn } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { randomUUID } from "crypto";
import { Build } from "@aws-sdk/client-codebuild";
import {
  downloadFile,
  readStreamToBuffer,
  streamToString,
  uploadFile,
} from "./S3Client";
import { logInfo } from "./logger";

// Stands in for CodeBuild when DEPLOY_TARGET=localstack: runs the same steps as
// the buildspec in deploymentEvent.ts inside the backend container and deploys
// the generated service to LocalStack. State and logs live in S3 under builds/
// so GetDeployment can read them back like a CodeBuild build.

interface LocalBuildState {
  build: Build;
  logs: string;
}

const FLUSH_INTERVAL_MS = 2000;

const stateKey = (buildId: string) => `builds/${buildId}.json`;

export const startLocalBuild = async (
  projectDir: string,
  projectFolder: string,
  projectName: string
) => {
  const state: LocalBuildState = {
    build: {
      id: `local:${randomUUID()}`,
      buildStatus: "IN_PROGRESS",
      currentPhase: "INSTALL",
      buildComplete: false,
    },
    logs: "",
  };

  const save = serialSaver(state);
  await save();

  // Not awaited: like CodeBuild, the build carries on after the trigger returns.
  const done = runLocalBuild(state, save, projectDir, projectFolder, projectName);

  return { build: { ...state.build }, done };
};

export const getLocalBuild = async (
  buildId: string
): Promise<{ build: Build | null; logs: string }> => {
  const text = await streamToString(await downloadFile(stateKey(buildId)));
  if (!text) {
    return { build: null, logs: "No logs found" };
  }

  const state = JSON.parse(text) as LocalBuildState;
  return { build: state.build, logs: state.logs };
};

export const patchServerlessYml = (projectDir: string) => {
  const path = join(projectDir, "serverless.yml");
  const doc = yaml.load(readFileSync(path, "utf-8")) as any;
  const endpoint = new URL(process.env.AWS_ENDPOINT ?? "http://localhost:4566");

  doc.plugins = Array.from(
    new Set([...(doc.plugins ?? []), "serverless-localstack"])
  );
  doc.custom = {
    ...(doc.custom ?? {}),
    localstack: {
      stages: ["prod"],
      host: `${endpoint.protocol}//${endpoint.hostname}`,
      edgePort: endpoint.port,
      autostart: false,
    },
  };

  writeFileSync(path, yaml.dump(doc));
};

// Saves run one after another so a slow periodic flush can't overwrite the final state.
const serialSaver = (state: LocalBuildState) => {
  let saving: Promise<unknown> = Promise.resolve();
  return () => {
    const body = JSON.stringify(state);
    saving = saving.then(() => uploadFile(stateKey(state.build.id!), body));
    return saving;
  };
};

async function runLocalBuild(
  state: LocalBuildState,
  save: () => Promise<unknown>,
  projectDir: string,
  projectFolder: string,
  projectName: string
) {
  const timer = setInterval(save, FLUSH_INTERVAL_MS);
  const step = async (
    phase: string,
    command: string,
    args: string[],
    env: Record<string, string> = {}
  ) => {
    state.build.currentPhase = phase;
    state.logs += `\n$ ${command} ${args.join(" ")}\n`;
    await save();
    await runCommand(command, args, projectDir, env, (chunk) => {
      state.logs += chunk;
    });
  };

  try {
    patchServerlessYml(projectDir);

    await step("INSTALL", "npm", ["install"]);
    await step("INSTALL", "npm", [
      "install",
      "--save-dev",
      "serverless-localstack",
      "@types/node",
    ]);
    await step("BUILD", "npm", ["run", "build"]);
    await step("BUILD", "node", ["./docs.js", "-p", projectName]);

    const swagger = await readStreamToBuffer(
      join(projectDir, "dist", "swagger-json.json")
    );
    if (!(await uploadFile(projectFolder + "/swagger-json.json", swagger))) {
      throw new Error("Failed to upload swagger-json.json");
    }

    await step("POST_BUILD", "sls", ["deploy", "--stage", "prod"], {
      NODE_ENV: "production",
    });

    state.build.buildStatus = "SUCCEEDED";
  } catch (error) {
    state.logs += `\n${error}\n`;
    state.build.buildStatus = "FAILED";
  }

  clearInterval(timer);
  state.build.currentPhase = "COMPLETED";
  state.build.buildComplete = true;
  await save();
  logInfo(
    runLocalBuild.name,
    `Local build ${state.build.id} ${state.build.buildStatus}`
  );
}

// No shell: arguments (e.g. the project name) are passed through verbatim.
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  onOutput: (chunk: string) => void
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: process.env.AWS_KEY,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET,
        AWS_REGION: process.env.AWS_DEPLOY_REGION,
        ...env,
      },
    });

    child.stdout.on("data", (chunk) => onOutput(chunk.toString()));
    child.stderr.on("data", (chunk) => onOutput(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`))
    );
  });
}
