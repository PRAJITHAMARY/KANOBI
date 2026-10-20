import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Login from "./Login";
import { pending, renderWithRouter } from "../test/utils";

const renderLogin = (
  loaderData = { expired: false, redirectTo: "" },
  action: (fields: Record<string, FormDataEntryValue>) => unknown = () => pending()
) =>
  renderWithRouter([
    {
      path: "/",
      Component: Login,
      loader: () => loaderData,
      action: async ({ request }) => action(Object.fromEntries(await request.formData())),
    },
  ]);

describe("Login", () => {
  it("renders a labelled sign-in form", async () => {
    renderLogin();

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("submits the credentials and the page to return to, showing a loading screen", async () => {
    let submitted: Record<string, FormDataEntryValue> = {};
    renderLogin({ expired: false, redirectTo: "/project/p1" }, (fields) => {
      submitted = fields;
      return pending();
    });

    await userEvent.type(await screen.findByLabelText("Email"), "demo@kanobi.local");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Please wait...")).toBeInTheDocument();
    expect(submitted).toEqual({
      redirectTo: "/project/p1",
      email: "demo@kanobi.local",
      password: "secret",
    });
  });

  it("shows a sign-in error as a form banner", async () => {
    renderLogin({ expired: true, redirectTo: "" }, () => ({ error: "Invalid email or password" }));

    await userEvent.type(await screen.findByLabelText("Email"), "a@b.c");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    // The banner replaces the expired-session notice.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains an expired session", async () => {
    renderLogin({ expired: true, redirectTo: "" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your session has expired. Sign in again."
    );
  });
});
