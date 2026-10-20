import { describe, expect, it, vi } from "vitest";
import { projectDetailLoader } from "./loader";
import { API, jsonResponse, mockFetch } from "../test/utils";

describe("projectDetailLoader", () => {
  it("loads the project and its deployment", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { id: "1", name: "Shop" } }),
      jsonResponse({ data: { buildStatus: "SUCCEEDED" } })
    );

    await expect(projectDetailLoader({ params: { id: "1" } })).resolves.toEqual({
      project: { id: "1", name: "Shop" },
      deployment: { buildStatus: "SUCCEEDED" },
    });
    expect(fetchMock.mock.calls).toEqual([
      [`${API}/project/1`, { headers: {} }],
      [`${API}/deployment/1`, { headers: {} }],
    ]);
  });

  it("redirects back to the list when the project is missing", async () => {
    const fetchMock = mockFetch(jsonResponse({ message: "Not found" }, 404));

    const res = (await projectDetailLoader({ params: { id: "x" } })) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/project");
    expect(alert).toHaveBeenCalledWith("Error fetching project");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("alerts on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(projectDetailLoader({ params: { id: "1" } })).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledWith("offline");
  });
});
