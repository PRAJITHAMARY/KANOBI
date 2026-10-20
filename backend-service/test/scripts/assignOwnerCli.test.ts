import { afterEach, expect, it, vi } from "vitest";

const script = vi.hoisted(() => ({ main: vi.fn() }));
vi.mock("../../src/scripts/assignOwner", () => script);

const argv = process.argv;
afterEach(() => {
  process.argv = argv;
});

it("runs the script with the command-line arguments", async () => {
  process.argv = ["node", "assignOwnerCli.js", "user-1"];
  await import("../../src/scripts/assignOwnerCli");
  expect(script.main).toHaveBeenCalledWith(["user-1"]);
});
