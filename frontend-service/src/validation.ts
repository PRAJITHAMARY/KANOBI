// Mirrors backend-service/src/utils/names.ts. The backend enforces these rules;
// checking them here lets forms show the error before anything is sent.

const NAME_MAX_LENGTH = 40;

export const PROJECT_NAME_HINT =
  "Lowercase letters, numbers and hyphens, 3+ characters.";

export const projectNameError = (name: string): string | undefined => {
  if (name.length < 3) return "Project name must be at least 3 characters";
  if (name.length > NAME_MAX_LENGTH)
    return `Project name must be at most ${NAME_MAX_LENGTH} characters`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
    return "Project name can only contain lowercase letters, numbers and hyphens";
  return undefined;
};

const identifierError = (
  name: string,
  label: string,
  pattern: RegExp,
  rule: string,
  others: string[]
): string | undefined => {
  if (!name) return `${label} is required`;
  if (name.length > NAME_MAX_LENGTH)
    return `${label} must be at most ${NAME_MAX_LENGTH} characters`;
  if (!pattern.test(name)) return `${label} must be ${rule}`;
  if (others.some((other) => other.toLowerCase() === name.toLowerCase()))
    return `${label} is already used`;
  return undefined;
};

/** `others` are the names of the other models in the project. */
export const modelNameError = (name: string, others: string[] = []) =>
  identifierError(
    name,
    "Model name",
    /^[A-Z][A-Za-z0-9]*$/,
    "PascalCase: start with a capital letter, then letters and numbers only",
    others
  );

/** `others` are the names of the other fields in the same model. */
export const propertyNameError = (name: string, others: string[] = []) =>
  identifierError(
    name,
    "Field name",
    /^[a-z][A-Za-z0-9]*$/,
    "camelCase: start with a lowercase letter, then letters and numbers only",
    others
  );

/** The readable message from a failed API response. */
export const responseErrorMessage = async (response: Response) => {
  try {
    const body = await response.json();
    if (typeof body?.message === "string" && body.message) return body.message;
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return `Request failed (${response.status})`;
};
