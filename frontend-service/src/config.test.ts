import { describe, expect, it } from "vitest";
import { API_URL } from "./config";
import { API } from "./test/utils";

describe("API_URL", () => {
  it("comes from VITE_API_URL (.env.test in tests)", () => {
    expect(API_URL).toBe(import.meta.env.VITE_API_URL);
    expect(API_URL).toBe(API);
  });
});
