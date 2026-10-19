import { describe, expect, it } from "vitest";
import {
  generateSetUpdateExpression,
  getId,
  getNodeName,
  getPutOperators,
  getTableName,
  sanitizeData,
} from "../../src/utils/dynamodbHelpers";
import { PROJECT_ID } from "../helpers";

describe("dynamodbHelpers", () => {
  it("getTableName builds a lower-cased, project-suffixed table name", () => {
    // resource name strips dashes; the suffix is everything after char 26
    expect(getTableName(PROJECT_ID, " User Account ")).toBe(
      "useraccountsTable555555"
    );
    expect(getTableName(undefined, "Post")).toBe("postsTable");
    // Every space is removed, not only the first (legacy names may contain several).
    expect(getTableName(undefined, "Order  Line Item")).toBe("orderlineitemsTable");
  });

  it("getNodeName slugs names", () => {
    expect(getNodeName("  My  Model!* name ")).toBe("My-Model-name");
  });

  it("getId returns the part after the key prefix", () => {
    expect(getId("pr_abc")).toBe("abc");
  });

  describe("sanitizeData", () => {
    it("derives id from pk by default and strips keys", () => {
      expect(sanitizeData({ pk: "pr_1", sk: "pr_1", name: "n" })).toEqual({
        id: "1",
        name: "n",
      });
    });

    it("can derive id from sk and strips relation table names", () => {
      const item = {
        pk: "pr_1",
        sk: "ml_2",
        relations: [{ modelId: "3", tableName: "t" }],
      };
      expect(sanitizeData(item, "sk")).toEqual({
        id: "2",
        relations: [{ modelId: "3" }],
      });
    });
  });

  it("getPutOperators builds a set expression from every key", () => {
    expect(getPutOperators({ name: "n", count: 2 })).toEqual({
      updateExpression: "set #name = :name, #count = :count",
      expressionAttributeNames: { "#name": "name", "#count": "count" },
      expressionAttributeValues: { ":name": "n", ":count": 2 },
    });
  });

  it("generateSetUpdateExpression flattens nested objects", () => {
    expect(
      generateSetUpdateExpression({
        a: { b: 1, c: { d: "x" } },
        list: [1, 2],
        empty: null,
      })
    ).toEqual({
      UpdateExpression:
        "SET #key0_0.#key0_1 = :val0, #key1_0.#key1_1.#key1_2 = :val1, #key2_0 = :val2, #key3_0 = :val3",
      ExpressionAttributeNames: {
        "#key0_0": "a",
        "#key0_1": "b",
        "#key1_0": "a",
        "#key1_1": "c",
        "#key1_2": "d",
        "#key2_0": "list",
        "#key3_0": "empty",
      },
      ExpressionAttributeValues: {
        ":val0": 1,
        ":val1": "x",
        ":val2": [1, 2],
        ":val3": null,
      },
    });
  });
});
