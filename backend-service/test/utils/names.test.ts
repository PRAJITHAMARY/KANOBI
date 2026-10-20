import { describe, expect, it } from "vitest";
import {
  assertSafeModel,
  findModelNameProblem,
  ModelNameSchema,
  ProjectNameSchema,
  PropertyNameSchema,
  PropertyTypeSchema,
  sameName,
} from "../../src/utils/names";

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0].message;

describe("ProjectNameSchema", () => {
  it.each(["shop", "my-shop", "shop-2", "a1b", "x".repeat(40)])("accepts %s", (name) => {
    expect(ProjectNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ["x; rm -rf /", "lowercase letters, numbers and hyphens"],
    ["$(whoami)", "lowercase letters, numbers and hyphens"],
    ["Shop", "lowercase letters, numbers and hyphens"],
    ["my shop", "lowercase letters, numbers and hyphens"],
    ["-shop", "lowercase letters, numbers and hyphens"],
    ["shop-", "lowercase letters, numbers and hyphens"],
    ["my--shop", "lowercase letters, numbers and hyphens"],
    ["ab", "at least 3 characters"],
    ["x".repeat(41), "at most 40 characters"],
  ])("rejects %j", (name, message) => {
    expect(firstMessage(ProjectNameSchema.safeParse(name))).toContain(message);
  });
});

describe("ModelNameSchema", () => {
  it.each(["User", "U", "OrderItem", "Item2"])("accepts %s", (name) => {
    expect(ModelNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(["user", "Order Item", "Order-Item", "User*/", "2User", "", "U".repeat(41)])(
    "rejects %j",
    (name) => {
      expect(ModelNameSchema.safeParse(name).success).toBe(false);
    }
  );

  it("explains the rule", () => {
    expect(firstMessage(ModelNameSchema.safeParse("user"))).toContain("PascalCase");
  });
});

describe("PropertyNameSchema", () => {
  it.each(["email", "a", "createdAt", "line2"])("accepts %s", (name) => {
    expect(PropertyNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(["Email", "first name", "x:", "*/", "", "a".repeat(41)])("rejects %j", (name) => {
    expect(PropertyNameSchema.safeParse(name).success).toBe(false);
  });

  it("explains the rule", () => {
    expect(firstMessage(PropertyNameSchema.safeParse("Email"))).toContain("camelCase");
  });
});

describe("PropertyTypeSchema", () => {
  it.each(["string", "number", "boolean"])("accepts %s", (type) => {
    expect(PropertyTypeSchema.safeParse(type).success).toBe(true);
  });

  it("rejects other types with a readable message", () => {
    expect(firstMessage(PropertyTypeSchema.safeParse("object\n  x: 1"))).toBe(
      "Field type must be one of string, number, boolean"
    );
  });
});

describe("sameName", () => {
  it("compares case-insensitively", () => {
    expect(sameName("User", "user")).toBe(true);
    expect(sameName("User", "Users")).toBe(false);
  });
});

describe("findModelNameProblem / assertSafeModel", () => {
  const valid = {
    name: "User",
    properties: [{ name: "email", type: "string" }],
  };

  it("finds nothing wrong with a valid model", () => {
    expect(findModelNameProblem(valid)).toBeUndefined();
    expect(() => assertSafeModel(valid)).not.toThrow();
  });

  it("finds nothing wrong with a model without properties", () => {
    expect(findModelNameProblem({ name: "User", properties: [] })).toBeUndefined();
  });

  it.each([
    [{ ...valid, name: "user" }, "Model name must be PascalCase"],
    [{ ...valid, properties: [{ name: "e mail", type: "string" }] }, "Field name must be camelCase"],
    [{ ...valid, properties: [{ name: "email", type: "date" }] }, "Field type must be one of"],
  ])("reports the first problem %#", (model, message) => {
    expect(findModelNameProblem(model)).toContain(message);
    expect(() => assertSafeModel(model)).toThrow(
      `Refusing to generate code for model "${model.name}": ${message}`
    );
  });
});
