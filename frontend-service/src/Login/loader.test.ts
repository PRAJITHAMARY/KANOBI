import { beforeEach, describe, expect, it } from "vitest";
import { loginLoader, safeRedirect } from "./loader";

const load = (url: string) => loginLoader({ request: new Request(url) });

const thrownBy = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as Response;
  }
  throw new Error("expected a redirect");
};

beforeEach(() => sessionStorage.clear());

describe("loginLoader", () => {
  it("shows the form to a signed-out user", () => {
    expect(load("http://localhost/")).toEqual({ expired: false, redirectTo: "" });
  });

  it("passes on the expired notice and the page to return to", () => {
    expect(load("http://localhost/?expired=1&redirectTo=%2Fproject%2Fp1")).toEqual({
      expired: true,
      redirectTo: "/project/p1",
    });
  });

  it("sends a signed-in user on to the requested page", () => {
    sessionStorage.setItem(
      "kanobi.session",
      JSON.stringify({ email: "a", idToken: "t", refreshToken: "r" })
    );
    const res = thrownBy(() => load("http://localhost/?redirectTo=%2Fproject%2Fp1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/project/p1");
  });
});

describe("safeRedirect", () => {
  it.each([
    ["/project/p1", "/project/p1"],
    ["/project?x=1", "/project?x=1"],
    [null, "/project"],
    [undefined, "/project"],
    ["", "/project"],
    ["https://evil.example", "/project"],
    ["//evil.example", "/project"],
    ["/\\evil.example", "/project"],
  ])("%j -> %j", (to, expected) => {
    expect(safeRedirect(to)).toBe(expected);
  });
});
