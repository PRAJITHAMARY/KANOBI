import { describe, expect, it } from "vitest";
import { DeleteAPIFunction, SetupAPIFunction } from "../../src/utils/codeBuilder";
import { ApiMethod, AppModel } from "../../src/types";
import { indexTemplateText, PROJECT_ID, sourceFileOf } from "../helpers";

const allApis = Object.values(ApiMethod).map((method) => ({
  method,
  generate: true,
}));

const userModel = (overrides: Partial<AppModel> = {}): AppModel => ({
  name: "User",
  properties: [
    { name: "email", type: "string", required: true },
    { name: "age", type: "number", required: false },
  ],
  apis: allApis,
  relations: undefined as unknown as AppModel["relations"],
  ...overrides,
});

const setup = () => ({
  template: sourceFileOf("indexTemplate.ts", indexTemplateText),
  target: sourceFileOf("index.ts", "// generated"),
  functions: {} as Record<string, any>,
});

const docsOf = (target: ReturnType<typeof setup>["target"], name: string) =>
  target
    .getFunctionOrThrow(name)
    .getJsDocs()
    .map((d) => d.getInnerText())
    .join("\n");

describe("SetupAPIFunction", () => {
  it.each([
    [userModel({ name: "User */ export const x = 1; /*" }), "Model name must be PascalCase"],
    [
      userModel({ properties: [{ name: "x:\n  evil", type: "string", required: true }] }),
      "Field name must be camelCase",
    ],
    [
      userModel({ properties: [{ name: "email", type: "string\n- y", required: true }] }),
      "Field type must be one of",
    ],
  ])("refuses to generate code from unsafe names %#", async (model, message) => {
    const { template, target, functions } = setup();

    await expect(
      SetupAPIFunction(template, target, model, functions, PROJECT_ID)
    ).rejects.toThrow(message);
    expect(functions).toEqual({});
    expect(target.getFunctions()).toHaveLength(0);
  });

  it("generates a handler and serverless function for every enabled API", async () => {
    const { template, target, functions } = setup();

    await SetupAPIFunction(template, target, userModel(), functions, PROJECT_ID);

    expect(Object.keys(functions).sort()).toEqual(
      [
        "deleteUser",
        "deletemultipleUser",
        "getUser",
        "getoneUser",
        "postUser",
        "postmultipleUser",
        "putUser",
      ].sort()
    );
    expect(functions.getoneUser).toMatchObject({
      handler: "dist/index.GetoneUser",
      tags: { Service: "service-555555", Project: PROJECT_ID },
      events: [{ http: { path: "/User/{id}", method: "get" } }],
    });

    const routes = Object.fromEntries(
      Object.entries(functions).map(([k, v]) => [
        k,
        `${v.events[0].http.method} ${v.events[0].http.path}`,
      ])
    );
    expect(routes).toEqual({
      getoneUser: "get /User/{id}",
      getUser: "get /User",
      postUser: "post /User",
      putUser: "put /User/{id}",
      deleteUser: "delete /User/{id}",
      postmultipleUser: "post /multiple-User",
      deletemultipleUser: "delete /multiple-User/{ids}",
    });

    for (const name of [
      "GetoneUser",
      "GetUser",
      "PostUser",
      "PutUser",
      "DeleteUser",
      "PostmultipleUser",
      "DeletemultipleUser",
    ]) {
      const fn = target.getFunctionOrThrow(name);
      expect(fn.isExported()).toBe(true);
      expect(fn.isAsync()).toBe(true);
    }

    const body = target.getFunctionOrThrow("GetUser").getBodyText();
    expect(body).toContain("process.env.USERSTABLE555555");
    expect(body).toContain("GetUser.name");
    expect(body).not.toContain("process.env.TABLE_NAME");
  });

  it("writes OpenAPI docs that match each API shape", async () => {
    const { template, target, functions } = setup();
    await SetupAPIFunction(template, target, userModel(), functions, PROJECT_ID);

    const getone = docsOf(target, "GetoneUser");
    expect(getone).toContain("summary: Gets a single User by Id");
    expect(getone).toContain("name: includes");
    expect(getone).not.toContain("requestBody");

    const get = docsOf(target, "GetUser");
    expect(get).toContain("summary: Fetches all User");
    expect(get).not.toContain("parameters:");
    expect(get).toContain("type: array");

    const post = docsOf(target, "PostUser");
    expect(post).toContain("requestBody");
    expect(post).toMatch(/- email/);
    expect(post).not.toMatch(/- age/);

    const postMultiple = docsOf(target, "PostmultipleUser");
    expect(postMultiple).toContain("summary: Creates multiple User");
    expect(postMultiple).toContain("items:");

    const put = docsOf(target, "PutUser");
    expect(put).toContain("name: id");
    expect(put).not.toContain("name: includes");
    expect(put).toContain("204:");

    const delMultiple = docsOf(target, "DeletemultipleUser");
    expect(delMultiple).toContain("name: ids");
    expect(delMultiple).toContain("comma separated ids");
  });

  it("inlines relations into handlers that resolve them", async () => {
    const { template, target, functions } = setup();
    const relations = [
      {
        modelId: "m2",
        mainModel: "User",
        relatedModel: "Post",
        relationship: "one-to-many",
        tableName: "postsTable555555",
      },
    ];

    await SetupAPIFunction(
      template,
      target,
      userModel({ relations }),
      functions,
      PROJECT_ID
    );

    for (const name of ["PostUser", "GetoneUser", "PutUser"]) {
      const body = target.getFunctionOrThrow(name).getBodyText();
      expect(body).toContain('relatedModel: "Post"');
      expect(body).not.toContain("let relations: any[] = [];");
    }
    expect(target.getFunctionOrThrow("GetUser").getBodyText()).not.toContain(
      'relatedModel: "Post"'
    );
  });

  it("removes functions for disabled APIs and keeps existing enabled ones", async () => {
    const { template, target } = setup();
    const functions: Record<string, any> = {
      getUser: { handler: "existing" },
      postUser: { handler: "existing" },
    };

    await SetupAPIFunction(
      template,
      target,
      userModel({
        apis: [
          { method: ApiMethod.get, generate: false },
          { method: ApiMethod.post, generate: true },
          { method: ApiMethod.put, generate: false },
        ],
      }),
      functions,
      undefined
    );

    expect(functions).toEqual({ postUser: { handler: "existing" } });
    expect(target.getFunctions()).toHaveLength(0);
  });

  it("uses an empty service suffix without a project id", async () => {
    const { template, target, functions } = setup();
    await SetupAPIFunction(
      template,
      target,
      userModel({ apis: [{ method: ApiMethod.get, generate: true }] }),
      functions,
      undefined
    );
    expect(functions.getUser.tags).toEqual({ Service: "service-", Project: undefined });
  });

  it("leaves the API shape empty for unknown methods", async () => {
    const { target, functions } = setup();
    // A template that defines a handler for a non-standard method name.
    const template = sourceFileOf(
      "t.ts",
      "export async function Custom(event: any): Promise<any> { return 1; }"
    );

    await SetupAPIFunction(
      template,
      target,
      userModel({ apis: [{ method: "custom" as ApiMethod, generate: true }] }),
      functions,
      PROJECT_ID
    );

    expect(functions.customUser.events[0].http).toMatchObject({
      method: "",
      path: "",
    });
  });
});

describe("DeleteAPIFunction", () => {
  it("removes generated functions and their handlers", async () => {
    const { template, target, functions } = setup();
    const model = userModel();
    await SetupAPIFunction(template, target, model, functions, PROJECT_ID);

    DeleteAPIFunction(
      target,
      {
        ...model,
        apis: [...model.apis, { method: "custom" as ApiMethod, generate: true }],
      },
      functions
    );

    expect(functions).toEqual({});
    expect(target.getFunctions()).toHaveLength(0);
  });
});
