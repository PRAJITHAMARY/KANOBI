import { getResourceName } from "./infraHelper";

export const getTableName = (
  projectId: string | undefined,
  modelName: string
): string => {
  return (
    modelName.replace(/\s+/g, "").toLowerCase() +
    "sTable" +
    getResourceName(projectId).substring(26).toUpperCase()
  );
};

export const getNodeName = (name: string): string => {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
};

export const getId = (pk_sk: string): string => {
  return pk_sk.split("_")[1];
};

export function sanitizeData<TResponse>(item: any, key: "pk" | "sk" = "pk") {
  item.id = getId(item[key]);
  delete item.pk;
  delete item.sk;

  if (item.relations) {
    for (let rel of item.relations) {
      delete rel.tableName;
    }
  }
  return item as TResponse;
}

export const getPutOperators = (body: any) => {
  const keys = Object.keys(body);
  const updateExpression = "set " + keys.map((x) => `#${x} = :${x}`).join(", ");
  const expressionAttributeNames: any = {};
  const expressionAttributeValues: any = {};

  for (let key of keys) {
    expressionAttributeNames["#" + key] = key;
    expressionAttributeValues[":" + key] = body[key];
  }

  return {
    updateExpression,
    expressionAttributeNames,
    expressionAttributeValues,
  };
};

type UpdateExpressionResult = {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, any>;
};

function flattenObject(
  obj: Record<string, any>,
  parentPath: string[] = []
): { path: string[]; value: any }[] {
  const entries: { path: string[]; value: any }[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...parentPath, key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenObject(value, currentPath));
    } else {
      entries.push({ path: currentPath, value });
    }
  }

  return entries;
}

export function generateSetUpdateExpression(
  updateObj: Record<string, any>
): UpdateExpressionResult {
  const flatEntries = flattenObject(updateObj);

  const names: Record<string, string> = {};
  const values: Record<string, any> = {};
  const expressions: string[] = [];

  flatEntries.forEach(({ path, value }, index) => {
    const pathPlaceholders = path.map((part, i) => {
      const nameKey = `#key${index}_${i}`;
      names[nameKey] = part;
      return nameKey;
    });

    const valueKey = `:val${index}`;
    values[valueKey] = value;

    expressions.push(`${pathPlaceholders.join(".")} = ${valueKey}`);
  });

  return {
    UpdateExpression: `SET ${expressions.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}
