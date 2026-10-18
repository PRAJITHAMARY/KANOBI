import { expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../../src/local/devServer", () => server);

it("starts the dev server", async () => {
  await import("../../src/local/index");
  expect(server.start).toHaveBeenCalledWith();
});
