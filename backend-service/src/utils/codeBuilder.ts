import { SourceFile, SyntaxKind } from "ts-morph";
import { ApiMethod, ApiSettings, AppModel } from "../types";
import { logInfo } from "./logger";
import { getTableName } from "./dynamodbHelpers";
import { getServiceName } from "./infraHelper";
import { assertSafeModel } from "./names";

const setupAPI = (method: string, modelName: string) => {
  const api: ApiSettings = {
    method: "",
    path: "",
    summary: "",
    hasParam: true,
    hasBody: true,
    hasResponse: true,
    paramName: "id",
    responseType: "object",
    bodyType: "object",
  };

  if (method.startsWith("get")) {
    api.method = "get";
    api.hasParam = method.startsWith("getone");
    api.hasBody = false;
    api.path = `/${modelName}`;
    api.summary = `Fetches all ${modelName}`;
    api.responseType = "array";
    if (method.startsWith("getone")) {
      api.path = `/${modelName}/{id}`;
      api.summary = `Gets a single ${modelName} by Id`;
      api.responseType = "object";
    }
  } else if (method.startsWith("post")) {
    api.method = "post";
    api.hasParam = false;
    api.path = `/${modelName}`;
    api.summary = `Creates a single ${modelName}`;
    if (method.includes("multiple")) {
      api.path = `/multiple-${modelName}`;
      api.summary = `Creates multiple ${modelName}`;
      api.bodyType = "array";
      api.responseType = "array";
    }
  } else if (method.startsWith("put")) {
    api.method = "put";
    api.path = `/${modelName}/{id}`;
    api.summary = `Edits a single ${modelName} by Id`;
    api.hasResponse = false;
  } else if (method.startsWith("delete")) {
    api.method = "delete";
    api.hasResponse = false;
    api.hasBody = false;
    api.path = `/${modelName}/{id}`;
    api.summary = `Deletes a single ${modelName} by Id`;

    if (method.includes("multiple")) {
      api.path = `/multiple-${modelName}/{ids}`;
      api.summary = `Deletes multiple ${modelName} with comma separated ids`;
      api.paramName = "ids";
    }
  }

  return api;
};

const createHandlers = (
  sourceFile: SourceFile,
  targetFile: SourceFile,
  capitalizedMethod: string,
  model: AppModel,
  projectId: string | undefined,
  http: ApiSettings,
  method: ApiMethod
) => {
  const handler = sourceFile.getFunctionOrThrow(capitalizedMethod);

  let statements = handler
    .getBodyText()
    ?.replace(
      /process\.env\.TABLE_NAME/g,
      "process.env." + getTableName(projectId, model.name).toUpperCase()
    )
    ?.replace(
      /process\.env\.FUNCTION_NAME/g,
      `${capitalizedMethod + model.name}.name`
    );

  if (
    method == ApiMethod.post ||
    method == ApiMethod.getone ||
    method == ApiMethod.put
  ) {
    if (model.relations) {
      const relationObjects = model.relations;
      const arrayString = JSON.stringify(relationObjects, null, 2)
        .replace(/"([^"]+)":/g, "$1:")
        .replace(/"/g, '"');

      statements = statements?.replace(
        "let relations: any[] = [];",
        `let relations = ${arrayString};`
      );
    }
  }

  targetFile.addFunction({
    name: capitalizedMethod + model.name,
    isExported: true,
    parameters: handler.getParameters().map((param) => ({
      name: param.getName(),
      type: param.getType().getText(),
    })),
    returnType: handler.getReturnType().getText(),
    statements,
    isAsync: handler.isAsync(),
    isDefaultExport: handler.isDefaultExport(),
    docs: [
      `
      @openapi
      ${http.path}:
        ${http.method}:
          tags:
            - ${model.name}
          summary: ${http.summary}
          ${
            http.hasParam
              ? `parameters:
            - in: path
              name: ${http.paramName}
              required: true
              schema:
                type: string
            ${
              http.method == "get"
                ? `
            - in: query
              name: includes
              required: false
              schema:
                type: string`
                : ""
            }
            `
              : ""
          }
          ${
            http.hasBody
              ? `requestBody:
              content:
                application/json:
                  schema:
                    type: ${http.bodyType}
                    ${
                      http.bodyType === "object"
                        ? `properties:
                      ${model.properties
                        .map((p) => {
                          return `
                        ${p.name}:
                          type: ${p.type}
                        `;
                        })
                        .join("\n")}
                        includes:
                          type: array
                          items:
                            type: object
                            properties:
                              model:
                                type: string
                              id:
                                type: string
                    required:
                      ${model.properties
                        .filter((x) => x.required)
                        .map((p) => {
                          return `
                        - ${p.name}
                        `;
                        })
                        .join("\n")}`
                        : `items:
                      type: object
                      properties:
                      ${model.properties
                        .map((p) => {
                          return `
                        ${p.name}:
                          type: ${p.type}
                        `;
                        })
                        .join("\n")}
                    required:
                      ${model.properties
                        .filter((x) => x.required)
                        .map((p) => {
                          return `
                        - ${p.name}
                        `;
                        })
                        .join("\n")}`
                    }
              `
              : ""
          }
          ${
            http.hasResponse
              ? `responses:
              200:
                description: Response data
                content:
                  application/json:
                    schema:
                      type: object
                      properties:
                        message:
                          type: string
                        meta:
                          type: object
                        data:
                          type: ${http.responseType}
                          ${
                            http.responseType === "object"
                              ? `properties:
                              id:
                                type: string
                              ${model.properties
                                .map((p) => {
                                  return `
                              ${p.name}:
                                type: ${p.type}
                              `;
                                })
                                .join("\n")}
                            `
                              : `items:
                              type: object
                              properties:
                                id:
                                  type: string
                                ${model.properties
                                  .map((p) => {
                                    return `
                                ${p.name}:
                                  type: ${p.type}
                                `;
                                  })
                                  .join("\n")}
                              `
                          }
              `
              : `responses:
              204:
                description: No content`
          }
      `.trim(),
    ],
  });
};

export const SetupAPIFunction = async (
  sourceFile: SourceFile,
  targetFile: SourceFile,
  model: AppModel,
  functions: any,
  projectId: string | undefined
) => {
  assertSafeModel(model);
  logInfo(
    SetupAPIFunction.name,
    "Creating endpoints and handlers for " + model.name
  );
  const serviceName = getServiceName(projectId || "");
  for (const api of model.apis) {
    if (functions[api.method + model.name]) {
      if (!api.generate) {
        delete functions[api.method + model.name];
      }
      continue;
    }

    if (!functions[api.method + model.name] && api.generate) {
      const capitalizedMethod =
        api.method.charAt(0).toUpperCase() + api.method.slice(1).toLowerCase();

      const http = setupAPI(api.method, model.name);
      functions[api.method + model.name] = {
        handler: `dist/index.${capitalizedMethod + model.name}`,
        tags: {
          Service: serviceName,
          Project: projectId,
        },
        events: [
          {
            http: {
              path: http.path,
              method: http.method,
              cors: {
                origin: "*",
                allowCredentials: false,
                headers: [
                  "Content-Type",
                  "X-Amz-Date",
                  "Authorization",
                  "X-Api-Key",
                  "X-Amz-Security-Token",
                ],
              },
            },
          },
        ],
      };

      createHandlers(
        sourceFile,
        targetFile,
        capitalizedMethod,
        model,
        projectId,
        http,
        api.method
      );
    }
  }
};

export const DeleteAPIFunction = (
  sourceFile: SourceFile,
  model: AppModel,
  functions: any
) => {
  logInfo(
    DeleteAPIFunction.name,
    "Deleting endpoints and handlers for " + model.name
  );

  for (const api of model.apis) {
    if (functions[api.method + model.name]) {
      delete functions[api.method + model.name];

      const capitalizedMethod =
        api.method.charAt(0).toUpperCase() + api.method.slice(1).toLowerCase();

      const handler = sourceFile.getFunctionOrThrow(
        capitalizedMethod + model.name
      );
      handler.remove();
    }
  }
};
