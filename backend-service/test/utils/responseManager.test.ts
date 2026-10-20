import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ResponseManager } from "../../src/utils/responseManager";
import { parseBody } from "../helpers";

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
};

describe("ResponseManager", () => {
  it("OkResponse uses defaults", () => {
    const res = ResponseManager.OkResponse({ a: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual(corsHeaders);
    expect(parseBody(res)).toEqual({ data: { a: 1 }, message: "ok", meta: {} });
  });

  it("OkResponse accepts meta and message", () => {
    const res = ResponseManager.OkResponse([1], { count: 1 }, "fine");
    expect(parseBody(res)).toEqual({ data: [1], message: "fine", meta: { count: 1 } });
  });

  it("CreatedResponse", () => {
    expect(ResponseManager.CreatedResponse("x").statusCode).toBe(201);
    expect(parseBody(ResponseManager.CreatedResponse("x"))).toEqual({
      data: "x",
      message: "created",
      meta: {},
    });
    expect(
      parseBody(ResponseManager.CreatedResponse("x", { m: 1 }, "made"))
    ).toEqual({ data: "x", message: "made", meta: { m: 1 } });
  });

  it("NoContentResponse has no body", () => {
    const res = ResponseManager.NoContentResponse();
    expect(res).toEqual({ statusCode: 204, headers: corsHeaders });
  });

  it("NotfoundResponse", () => {
    expect(parseBody(ResponseManager.NotfoundResponse())).toEqual({
      message: "Not found",
    });
    const res = ResponseManager.NotfoundResponse("gone");
    expect(res.statusCode).toBe(404);
    expect(parseBody(res)).toEqual({ message: "gone" });
  });

  it("AuthFailedResponse", () => {
    expect(parseBody(ResponseManager.AuthFailedResponse())).toEqual({
      message: "Auth failed",
    });
    const res = ResponseManager.AuthFailedResponse("nope");
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toEqual({ message: "nope" });
  });

  it("BadRequestResponse", () => {
    expect(parseBody(ResponseManager.BadRequestResponse("bad"))).toEqual({
      data: "bad",
      message: "Bad request",
    });
    const res = ResponseManager.BadRequestResponse(["e"], "invalid");
    expect(res.statusCode).toBe(400);
    expect(parseBody(res)).toEqual({ data: ["e"], message: "invalid" });
  });

  it("InternalErrorResponse logs the error", () => {
    const err = new Error("boom");
    const res = ResponseManager.InternalErrorResponse("fn", err);
    expect(res.statusCode).toBe(500);
    expect(parseBody(res)).toEqual({ message: "An unexpected error occured!" });
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      "[ERROR]: ",
      "FN",
      err
    );
    expect(
      parseBody(ResponseManager.InternalErrorResponse("fn", err, "custom"))
    ).toEqual({ message: "custom" });
  });

  describe("ValidationErrorResponse", () => {
    const schema = z.object({
      name: z.string().min(3, "too short"),
      items: z.array(z.object({ id: z.string() })),
    });
    const errorOf = (input: unknown) => {
      const result = schema.safeParse(input);
      if (result.success) throw new Error("expected a validation error");
      return result.error;
    };

    it("returns 400 with the issues and the first issue as the message", () => {
      const error = errorOf({ name: "x", items: [] });
      const res = ResponseManager.ValidationErrorResponse(error);
      expect(res.statusCode).toBe(400);
      expect(res.headers).toEqual(corsHeaders);
      expect(parseBody(res)).toEqual({
        data: JSON.parse(JSON.stringify(error.errors)),
        message: "name: too short",
      });
    });

    it("joins nested paths", () => {
      const res = ResponseManager.ValidationErrorResponse(
        errorOf({ name: "abc", items: [{ id: 1 }] })
      );
      expect(parseBody(res).message).toBe("items.0.id: Expected string, received number");
    });

    it("falls back to the default message when there are no issues", () => {
      const res = ResponseManager.ValidationErrorResponse(new z.ZodError([]));
      expect(parseBody(res)).toEqual({ data: [], message: "Bad request" });
    });

    it("omits an empty path", () => {
      const result = z.string().refine(() => false, "bad value").safeParse("x");
      const res = ResponseManager.ValidationErrorResponse(result.error as z.ZodError);
      expect(parseBody(res).message).toBe("bad value");
    });
  });

  describe("CORS origin", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("allows only CORS_ORIGIN when it is set", () => {
      vi.stubEnv("CORS_ORIGIN", "https://app.kanobi.dev");
      expect(ResponseManager.OkResponse({}).headers["Access-Control-Allow-Origin"]).toBe(
        "https://app.kanobi.dev"
      );
    });

    it("allows any origin when CORS_ORIGIN is unset or empty", () => {
      vi.stubEnv("CORS_ORIGIN", "");
      expect(ResponseManager.NoContentResponse().headers["Access-Control-Allow-Origin"]).toBe("*");
    });
  });
});
