import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import Layout from "./Layout";
import { getSession } from "../auth";
import { renderWithRouter } from "../test/utils";

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem(
    "kanobi.session",
    JSON.stringify({ email: "demo@kanobi.local", idToken: "t", refreshToken: "r" })
  );
});

const renderLayout = () =>
  renderWithRouter(
    [
      { path: "/", element: <h1>Sign in page</h1> },
      {
        Component: Layout,
        loader: () => ({ email: "demo@kanobi.local" }),
        children: [{ path: "/project", element: <h1>Projects page</h1> }],
      },
    ],
    ["/project"]
  );

describe("Layout", () => {
  it("shows the page with the signed-in user's email", async () => {
    renderLayout();
    expect(await screen.findByRole("heading", { name: "Projects page" })).toBeInTheDocument();
    expect(screen.getByText("demo@kanobi.local")).toBeInTheDocument();
  });

  it("signs out and returns to Sign in", async () => {
    renderLayout();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Sign in page" })).toBeInTheDocument();
    expect(getSession()).toBeUndefined();
  });
});
