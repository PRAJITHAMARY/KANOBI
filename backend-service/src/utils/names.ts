import { z } from "zod";

// Names end up in shell commands, generated TypeScript, OpenAPI YAML,
// serverless.yml and CloudFormation logical ids, so they are restricted to
// characters that are safe in all of those places.

export const PROJECT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MODEL_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
export const PROPERTY_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;
export const PROPERTY_TYPES = ["string", "number", "boolean"] as const;

export const NAME_MAX_LENGTH = 40;

export const ProjectNameSchema = z
  .string()
  .min(3, "Project name must be at least 3 characters")
  .max(NAME_MAX_LENGTH, `Project name must be at most ${NAME_MAX_LENGTH} characters`)
  .regex(
    PROJECT_NAME_PATTERN,
    "Project name can only contain lowercase letters, numbers and hyphens"
  );

export const ModelNameSchema = z
  .string()
  .max(NAME_MAX_LENGTH, `Model name must be at most ${NAME_MAX_LENGTH} characters`)
  .regex(
    MODEL_NAME_PATTERN,
    "Model name must be PascalCase: start with a capital letter, then letters and numbers only"
  );

export const PropertyNameSchema = z
  .string()
  .max(NAME_MAX_LENGTH, `Field name must be at most ${NAME_MAX_LENGTH} characters`)
  .regex(
    PROPERTY_NAME_PATTERN,
    "Field name must be camelCase: start with a lowercase letter, then letters and numbers only"
  );

export const PropertyTypeSchema = z.enum(PROPERTY_TYPES, {
  errorMap: () => ({
    message: `Field type must be one of ${PROPERTY_TYPES.join(", ")}`,
  }),
});

export const sameName = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

type NamedModel = {
  name: string;
  properties: { name: string; type: string }[];
};

/**
 * Returns the first rule a stored model breaks, or undefined when it is valid.
 * Rows written before the rules existed can still hold unsafe names.
 */
export const findModelNameProblem = (model: NamedModel): string | undefined => {
  const checks = [
    ModelNameSchema.safeParse(model.name),
    ...model.properties.flatMap((p) => [
      PropertyNameSchema.safeParse(p.name),
      PropertyTypeSchema.safeParse(p.type),
    ]),
  ];
  for (const check of checks) {
    if (!check.success) return check.error.issues[0].message;
  }
  return undefined;
};

/** Throws when a model is unsafe to generate code from. */
export const assertSafeModel = (model: NamedModel) => {
  const problem = findModelNameProblem(model);
  if (problem) {
    throw new Error(`Refusing to generate code for model "${model.name}": ${problem}`);
  }
};
