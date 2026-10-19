import { describe, expect, it, vi } from "vitest";
import { projectAction } from "./action";
import { API, formRequest, jsonResponse, mockFetch } from "../test/utils";

describe("projectAction", () => {
  it("creates a project", async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { id: "1" } }, 201));

    const res = await projectAction({
      request: formRequest({ action: "post", name: "shop", description: "d" }),
    });

    expect(res).toEqual({ success: true, data: { data: { id: "1" } } });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/project`, {
      method: "POST",
      body: JSON.stringify({ name: "shop", description: "d" }),
    });
  });

  it("deletes a project", async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));

    const res = await projectAction({
      request: formRequest({ action: "delete", projectId: "1" }),
    });

    expect(res).toEqual({ success: true, data: 204 });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/project/1`, { method: "DELETE" });
  });

  it("updates a project", async () => {
    const fetchMock = mockFetch(jsonResponse({}, 200));

    const res = await projectAction({
      request: formRequest({ action: "put", id: "1", name: "new-name", description: "d2" }),
    });

    expect(res).toEqual({ success: true, data: 200 });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/project/1`, {
      method: "PUT",
      body: JSON.stringify({ name: "new-name", description: "d2" }),
    });
  });

  it("returns the API error when creating fails", async () => {
    mockFetch(jsonResponse({ message: "name: Project name must be at least 3 characters" }, 400));

    const res = await projectAction({
      request: formRequest({ action: "post", name: "ab", description: "" }),
    });

    expect(res).toEqual({
      success: false,
      action: "post",
      error: "name: Project name must be at least 3 characters",
    });
  });

  it("returns the API error when updating fails", async () => {
    mockFetch(new Response("oops", { status: 500 }));

    const res = await projectAction({
      request: formRequest({ action: "put", id: "1", name: "shop", description: "" }),
    });

    expect(res).toEqual({
      success: false,
      action: "put",
      id: "1",
      error: "Request failed (500)",
    });
  });

  it("ignores unknown actions", async () => {
    const fetchMock = mockFetch(jsonResponse({}));
    await expect(projectAction({ request: formRequest({}) })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("alerts on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      projectAction({ request: formRequest({ action: "post", name: "shop" }) })
    ).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledWith("offline");
  });
});
