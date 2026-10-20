import { describe, expect, it } from "vitest";
import { Health } from "../../src/api/health/health";
import { parseBody } from "../helpers";

describe("Health", () => {
  it("reports ok", async () => {
    const res = await Health();
    expect(res.statusCode).toBe(200);
    expect(parseBody(res).data).toEqual({ status: "ok" });
  });
});
