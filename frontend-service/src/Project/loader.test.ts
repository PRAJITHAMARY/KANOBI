import { afterEach, describe, expect, it, vi } from "vitest";
import { projectsLoader } from "./loader";
import { API, jsonResponse, mockFetch } from "../test/utils";

describe("projectsLoader", () => {
  afterEach(() => sessionStorage.clear());

  it("fetches the signed-in user's project list", async () => {
    sessionStorage.setItem(
      "kanobi.session",
      JSON.stringify({ email: "a", idToken: "id-1", refreshToken: "r" })
    );
    const fetchMock = mockFetch(jsonResponse({ data: [{ id: "1" }] }));

    await expect(projectsLoader()).resolves.toEqual({
      projects: { data: [{ id: "1" }] },
    });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/project`, {
      headers: { Authorization: "id-1" },
    });
  });

  it("alerts when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(projectsLoader()).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledWith("offline");
  });
});
