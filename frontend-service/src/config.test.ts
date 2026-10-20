import { describe, expect, it } from "vitest";
import { API_URL, COGNITO_CLIENT_ID, COGNITO_ENDPOINT } from "./config";
import { API, COGNITO } from "./test/utils";

describe("API_URL", () => {
  it("comes from VITE_API_URL (.env.test in tests)", () => {
    expect(API_URL).toBe(import.meta.env.VITE_API_URL);
    expect(API_URL).toBe(API);
  });
});

describe("Cognito settings", () => {
  it("come from VITE_COGNITO_ENDPOINT and VITE_COGNITO_CLIENT_ID", () => {
    expect(COGNITO_ENDPOINT).toBe(COGNITO);
    expect(COGNITO_CLIENT_ID).toBe("test-client");
  });
});
