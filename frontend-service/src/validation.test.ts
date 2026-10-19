import { describe, expect, it } from "vitest";
import {
  modelNameError,
  projectNameError,
  propertyNameError,
  responseErrorMessage,
} from "./validation";

describe("projectNameError", () => {
  it.each(["shop", "my-shop-2", "x".repeat(40)])("accepts %s", (name) => {
    expect(projectNameError(name)).toBeUndefined();
  });

  it.each([
    ["ab", "Project name must be at least 3 characters"],
    ["x".repeat(41), "Project name must be at most 40 characters"],
    ["My Shop", "Project name can only contain lowercase letters, numbers and hyphens"],
    ["x; rm -rf /", "Project name can only contain lowercase letters, numbers and hyphens"],
    ["shop-", "Project name can only contain lowercase letters, numbers and hyphens"],
  ])("rejects %j", (name, message) => {
    expect(projectNameError(name)).toBe(message);
  });
});

describe("modelNameError", () => {
  it("accepts a PascalCase name not used by another model", () => {
    expect(modelNameError("OrderItem", ["User"])).toBeUndefined();
    expect(modelNameError("User")).toBeUndefined();
  });

  it.each([
    ["", [], "Model name is required"],
    ["U".repeat(41), [], "Model name must be at most 40 characters"],
    ["user", [], "Model name must be PascalCase: start with a capital letter, then letters and numbers only"],
    ["Order Item", [], "Model name must be PascalCase: start with a capital letter, then letters and numbers only"],
    ["USER", ["User"], "Model name is already used"],
  ])("rejects %j", (name, others, message) => {
    expect(modelNameError(name, others)).toBe(message);
  });
});

describe("propertyNameError", () => {
  it("accepts a camelCase name not used by another field", () => {
    expect(propertyNameError("createdAt", ["email"])).toBeUndefined();
    expect(propertyNameError("a")).toBeUndefined();
  });

  it.each([
    ["", [], "Field name is required"],
    ["Email", [], "Field name must be camelCase: start with a lowercase letter, then letters and numbers only"],
    ["eMail", ["email"], "Field name is already used"],
  ])("rejects %j", (name, others, message) => {
    expect(propertyNameError(name, others)).toBe(message);
  });
});

describe("responseErrorMessage", () => {
  it("uses the message from a JSON body", async () => {
    const res = new Response(JSON.stringify({ message: "name: too short" }), { status: 400 });
    expect(await responseErrorMessage(res)).toBe("name: too short");
  });

  it.each([
    ["a body without a message", JSON.stringify({ data: [] })],
    ["an empty message", JSON.stringify({ message: "" })],
    ["a JSON null body", "null"],
    ["a non-JSON body", "<html>bad gateway</html>"],
  ])("falls back to the status for %s", async (_case, body) => {
    expect(await responseErrorMessage(new Response(body, { status: 502 }))).toBe(
      "Request failed (502)"
    );
  });
});
