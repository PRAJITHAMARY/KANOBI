import { render } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from "react-router";
import { vi } from "vitest";

export const API = "http://api.test";

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Stub global fetch; each call resolves with the next response (last one repeats). */
export const mockFetch = (...responses: Array<Response | (() => Response)>) => {
  let call = 0;
  const fetchMock = vi.fn(async () => {
    const next = responses[Math.min(call++, responses.length - 1)];
    return typeof next === "function" ? next() : next.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/** Build an action Request carrying form fields. */
export const formRequest = (fields: Record<string, string>, url = "http://localhost/") =>
  new Request(url, { method: "POST", body: new URLSearchParams(fields) });

export const renderWithRouter = (routes: RouteObject[], initialEntries = ["/"]) => {
  const router = createMemoryRouter(routes, { initialEntries });
  return { router, ...render(<RouterProvider router={router} />) };
};

/** A promise that never settles; keeps a navigation pending. */
export const pending = () => new Promise<never>(() => {});
