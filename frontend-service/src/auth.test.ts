import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getIdToken,
  getSession,
  InvalidCredentialsError,
  refreshSession,
  signIn,
  signOut,
} from "./auth";
import { COGNITO, jsonResponse, mockFetch } from "./test/utils";

const session = { email: "demo@kanobi.local", idToken: "id-1", refreshToken: "refresh-1" };
const saveSession = (value: unknown) =>
  sessionStorage.setItem("kanobi.session", JSON.stringify(value));

const sentBody = (fetchMock: ReturnType<typeof mockFetch>) =>
  JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

beforeEach(() => sessionStorage.clear());

describe("signIn", () => {
  it("signs in with USER_PASSWORD_AUTH and stores the session", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ AuthenticationResult: { IdToken: "id-1", RefreshToken: "refresh-1" } })
    );

    await expect(signIn("demo@kanobi.local", "pw")).resolves.toEqual(session);

    expect(fetchMock).toHaveBeenCalledWith(COGNITO, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: expect.any(String),
    });
    expect(sentBody(fetchMock)).toEqual({
      ClientId: "test-client",
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: "demo@kanobi.local", PASSWORD: "pw" },
    });
    expect(getSession()).toEqual(session);
    expect(getIdToken()).toBe("id-1");
  });

  it.each([
    "NotAuthorizedException",
    "UserNotFoundException",
    "InvalidPasswordException",
    "com.amazonaws#NotAuthorizedException",
  ])("reports %s as invalid credentials", async (type) => {
    mockFetch(jsonResponse({ __type: type, message: "Incorrect username or password." }, 400));
    await expect(signIn("a@b.c", "x")).rejects.toThrow(InvalidCredentialsError);
    await expect(signIn("a@b.c", "x")).rejects.toThrow("Invalid email or password");
    expect(getSession()).toBeUndefined();
  });

  it.each([
    [{ __type: "TooManyRequestsException", message: "Slow down" }, "Slow down"],
    [{}, "Sign in failed. Try again."],
  ])("passes other Cognito errors on %#", async (body, message) => {
    mockFetch(jsonResponse(body, 400));
    await expect(signIn("a@b.c", "x")).rejects.toThrow(message);
  });

  it("explains a challenge Kanobi can't complete", async () => {
    mockFetch(jsonResponse({ ChallengeName: "NEW_PASSWORD_REQUIRED" }));
    await expect(signIn("a@b.c", "x")).rejects.toThrow(
      "This account can't sign in yet. Ask an admin to set a permanent password."
    );
    expect(getSession()).toBeUndefined();
  });
});

describe("getSession", () => {
  it("is empty without a stored session", () => {
    expect(getSession()).toBeUndefined();
    expect(getIdToken()).toBeUndefined();
  });

  it("ignores a corrupted session", () => {
    sessionStorage.setItem("kanobi.session", "{not json");
    expect(getSession()).toBeUndefined();
  });
});

describe("signOut", () => {
  it("forgets the session", () => {
    saveSession(session);
    signOut();
    expect(getSession()).toBeUndefined();
  });
});

describe("refreshSession", () => {
  it("swaps in a new ID token", async () => {
    saveSession(session);
    const fetchMock = mockFetch(jsonResponse({ AuthenticationResult: { IdToken: "id-2" } }));

    await expect(refreshSession()).resolves.toBe(true);

    expect(sentBody(fetchMock)).toEqual({
      ClientId: "test-client",
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: "refresh-1" },
    });
    expect(getSession()).toEqual({ ...session, idToken: "id-2" });
  });

  it("cannot refresh without a session", async () => {
    const fetchMock = mockFetch(jsonResponse({}));
    await expect(refreshSession()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a rejected refresh token", jsonResponse({ __type: "NotAuthorizedException" }, 400)],
    ["a response without tokens", jsonResponse({})],
  ])("fails on %s", async (_case, response) => {
    saveSession(session);
    mockFetch(response);
    await expect(refreshSession()).resolves.toBe(false);
    expect(getSession()).toEqual(session);
  });

  it("fails on network errors", async () => {
    saveSession(session);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(refreshSession()).resolves.toBe(false);
  });
});
