import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction } from "./action";
import { getSession } from "../auth";
import { formRequest, jsonResponse, mockFetch } from "../test/utils";

const signInResult = jsonResponse({
  AuthenticationResult: { IdToken: "id-1", RefreshToken: "refresh-1" },
});

beforeEach(() => sessionStorage.clear());

describe("loginAction", () => {
  it("signs in and returns to the requested page", async () => {
    const fetchMock = mockFetch(signInResult);

    const res = (await loginAction({
      request: formRequest({
        email: " demo@kanobi.local ",
        password: "pw",
        redirectTo: "/project/p1",
      }),
    })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/project/p1");
    expect(getSession()).toMatchObject({ email: "demo@kanobi.local", idToken: "id-1" });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.AuthParameters).toEqual({ USERNAME: "demo@kanobi.local", PASSWORD: "pw" });
  });

  it("goes to the dashboard without a safe page to return to", async () => {
    mockFetch(signInResult);
    const res = (await loginAction({
      request: formRequest({ email: "a@b.c", password: "pw", redirectTo: "https://evil.example" }),
    })) as Response;
    expect(res.headers.get("Location")).toBe("/project");
  });

  it("reports wrong credentials", async () => {
    mockFetch(jsonResponse({ __type: "NotAuthorizedException" }, 400));
    await expect(
      loginAction({ request: formRequest({ email: "a@b.c", password: "nope" }) })
    ).resolves.toEqual({ error: "Invalid email or password" });
    expect(getSession()).toBeUndefined();
  });

  it("sends empty fields when they are missing", async () => {
    const fetchMock = mockFetch(jsonResponse({ __type: "NotAuthorizedException" }, 400));
    await loginAction({ request: formRequest({}) });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.AuthParameters).toEqual({ USERNAME: "", PASSWORD: "" });
  });

  it("explains when Cognito can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(
      loginAction({ request: formRequest({ email: "a@b.c", password: "pw" }) })
    ).resolves.toEqual({ error: "Can't reach the sign-in service. Try again." });
  });

  it("passes on other sign-in errors", async () => {
    mockFetch(jsonResponse({ __type: "TooManyRequestsException", message: "Slow down" }, 400));
    await expect(
      loginAction({ request: formRequest({ email: "a@b.c", password: "pw" }) })
    ).resolves.toEqual({ error: "Slow down" });
  });
});
