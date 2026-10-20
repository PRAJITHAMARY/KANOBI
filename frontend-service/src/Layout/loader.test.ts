import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { requireAuth, withAuth } from "./loader";

const request = (url: string) => new Request(url);

beforeEach(() => sessionStorage.clear());

describe("requireAuth", () => {
  it("returns the signed-in user's email", () => {
    sessionStorage.setItem(
      "kanobi.session",
      JSON.stringify({ email: "demo@kanobi.local", idToken: "t", refreshToken: "r" })
    );
    expect(requireAuth({ request: request("http://localhost/project") })).toEqual({
      email: "demo@kanobi.local",
    });
  });

  it("sends a signed-out user to Sign in, remembering the page", () => {
    let thrown: unknown;
    try {
      requireAuth({ request: request("http://localhost/project/p1?tab=logs") });
    } catch (error) {
      thrown = error;
    }
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/?redirectTo=%2Fproject%2Fp1%3Ftab%3Dlogs"
    );
  });
});

describe("withAuth", () => {
  // Route loaders run in parallel, so each signed-in page's loader checks the
  // session itself instead of relying on the layout's guard.
  it("runs the page loader for a signed-in user", async () => {
    sessionStorage.setItem(
      "kanobi.session",
      JSON.stringify({ email: "demo@kanobi.local", idToken: "t", refreshToken: "r" })
    );
    const loader = vi.fn().mockResolvedValue({ project: 1 });
    const args = {
      request: request("http://localhost/project/p1"),
      params: { id: "p1" },
    } as unknown as LoaderFunctionArgs;

    await expect(withAuth(loader)(args)).resolves.toEqual({ project: 1 });
    expect(loader).toHaveBeenCalledWith(args);
  });

  it("sends a signed-out user to Sign in without calling the page loader", () => {
    const loader = vi.fn();
    let thrown: unknown;
    try {
      withAuth(loader)({
        request: request("http://localhost/project/p1"),
      } as unknown as LoaderFunctionArgs);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Response).headers.get("Location")).toBe("/?redirectTo=%2Fproject%2Fp1");
    expect(loader).not.toHaveBeenCalled();
  });
});
