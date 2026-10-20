import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { getSession } from "./auth";
import { API, COGNITO, jsonResponse } from "./test/utils";

const session = { email: "demo@kanobi.local", idToken: "id-1", refreshToken: "refresh-1" };

let assign: ReturnType<typeof vi.fn>;

/** Stub fetch per URL: API calls answer from `api` in order, Cognito from `cognito`. */
const stubFetch = (api: Response[], cognito: Response[] = []) => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url) => (url === COGNITO ? cognito : api).shift() as Response
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("kanobi.session", JSON.stringify(session));
  assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
});

describe("apiFetch", () => {
  it("sends the ID token on a request without a body", async () => {
    const fetchMock = stubFetch([jsonResponse({ data: [] })]);

    const res = await apiFetch("/project");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${API}/project`, {
      headers: { Authorization: "id-1" },
    });
  });

  it("adds the JSON content type to a request with a body", async () => {
    const fetchMock = stubFetch([jsonResponse({}, 201)]);

    await apiFetch("/project", { method: "POST", body: "{}" });

    expect(fetchMock).toHaveBeenCalledWith(`${API}/project`, {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json", Authorization: "id-1" },
    });
  });

  it("sends no Authorization header when signed out", async () => {
    sessionStorage.clear();
    const fetchMock = stubFetch([jsonResponse({})]);
    await apiFetch("/health");
    expect(fetchMock).toHaveBeenCalledWith(`${API}/health`, { headers: {} });
  });

  it("renews an expired token once and retries", async () => {
    const fetchMock = stubFetch(
      [jsonResponse({ message: "Unauthorized" }, 401), jsonResponse({ data: "ok" })],
      [jsonResponse({ AuthenticationResult: { IdToken: "id-2" } })]
    );

    const res = await apiFetch("/project");

    expect(await res.json()).toEqual({ data: "ok" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${API}/project`,
      COGNITO,
      `${API}/project`,
    ]);
    expect(fetchMock.mock.calls[2][1]).toEqual({ headers: { Authorization: "id-2" } });
    expect(assign).not.toHaveBeenCalled();
  });

  it("signs out and opens Sign in when the token can't be renewed", async () => {
    stubFetch(
      [jsonResponse({ message: "Unauthorized" }, 401)],
      [jsonResponse({ __type: "NotAuthorizedException" }, 400)]
    );

    const res = await apiFetch("/project");

    expect(res.status).toBe(401);
    expect(getSession()).toBeUndefined();
    expect(assign).toHaveBeenCalledWith("/?expired=1");
  });

  it("signs out when the renewed token is rejected too", async () => {
    const fetchMock = stubFetch(
      [jsonResponse({}, 401), jsonResponse({}, 401)],
      [jsonResponse({ AuthenticationResult: { IdToken: "id-2" } })]
    );

    await apiFetch("/project");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(assign).toHaveBeenCalledWith("/?expired=1");
  });

  // Route loaders run in parallel with the requireAuth guard, so a signed-out
  // visit reaches the API too; the guard, not apiFetch, sends the user to Sign in.
  it("leaves a 401 to the caller when nobody was signed in", async () => {
    sessionStorage.clear();
    const fetchMock = stubFetch([jsonResponse({ message: "Unauthorized" }, 401)]);

    expect((await apiFetch("/project")).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("leaves other errors to the caller", async () => {
    stubFetch([jsonResponse({ message: "nope" }, 404)]);
    expect((await apiFetch("/project/x")).status).toBe(404);
    expect(assign).not.toHaveBeenCalled();
    expect(getSession()).toEqual(session);
  });
});
