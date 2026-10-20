import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Projects from "./Projects";
import { pending, renderWithRouter } from "../test/utils";

const projects = {
  data: [
    { id: "1", name: "Shop", description: "Online shop", stackName: "service-1" },
    { id: "2", name: "Blog", description: "A blog" },
  ],
};

const renderProjects = (
  action: (fields: Record<string, FormDataEntryValue>) => unknown = () => ({ success: true })
) =>
  renderWithRouter(
    [
      {
        path: "/project",
        Component: Projects,
        loader: () => ({ projects }),
        action: async ({ request }) => action(Object.fromEntries(await request.formData())),
      },
      { path: "/elsewhere", loader: pending, element: null },
    ],
    ["/project"]
  );

describe("Projects", () => {
  it("lists a card per project", async () => {
    renderProjects();

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
    expect(screen.getByText("Online shop")).toBeInTheDocument();
    expect(screen.getByText("Blog")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("creates a project from the New dialog and closes it on success", async () => {
    const submissions: Record<string, FormDataEntryValue>[] = [];
    renderProjects((fields) => {
      submissions.push(fields);
      return { success: true };
    });

    await userEvent.click(await screen.findByRole("button", { name: "New" }));
    expect(screen.getByRole("heading", { name: "New Project" })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Project name"), "store");
    await userEvent.type(screen.getByPlaceholderText("description"), "desc");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toEqual({ name: "store", description: "desc", action: "post" });
    // The dashboard comes back one render before the effect that closes the
    // dialog runs (open state survives the loading screen), so wait for it.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "New Project" })).not.toBeInTheDocument()
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Dashboard" })
      ).toBeInTheDocument()
    );
  });

  it("shows the name rule as a hint", async () => {
    renderProjects();
    await userEvent.click(await screen.findByRole("button", { name: "New" }));
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveAccessibleDescription(
      "Lowercase letters, numbers and hyphens, 3+ characters."
    );
  });

  it("validates the name on blur and on submit without sending it", async () => {
    const submissions: unknown[] = [];
    renderProjects((fields) => {
      submissions.push(fields);
      return { success: true };
    });

    await userEvent.click(await screen.findByRole("button", { name: "New" }));
    const input = screen.getByRole("textbox", { name: "Project name" });

    await userEvent.type(input, "My Shop");
    await userEvent.tab();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Project name can only contain lowercase letters, numbers and hyphens"
    );

    // Submitting an empty name is caught too, and nothing reaches the action.
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(input).toHaveAccessibleDescription("Project name must be at least 3 characters");
    expect(submissions).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "New Project" })).toBeInTheDocument();

    // Fixing the name clears the error while typing.
    await userEvent.type(input, "my-shop");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription(
      "Lowercase letters, numbers and hyphens, 3+ characters."
    );
  });

  it("keeps the dialog open with the API error, and clears it when reopened", async () => {
    renderProjects(() => ({ success: false, action: "post", error: "name: taken" }));

    await userEvent.click(await screen.findByRole("button", { name: "New" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "shop");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("name: taken");
    expect(screen.getByRole("heading", { name: "New Project" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("shop");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("");
  });

  it("ignores errors from other project forms", async () => {
    renderProjects(() => ({ success: false, action: "put", id: "1", error: "nope" }));

    await userEvent.click(await screen.findByRole("button", { name: "New" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "shop");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByRole("heading", { name: "New Project" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Project name" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the dialog from the ✕ and Cancel buttons", async () => {
    renderProjects();

    await userEvent.click(await screen.findByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByRole("heading", { name: "New Project" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "New Project" })).not.toBeInTheDocument();
  });

  it("shows a loading screen while navigating", async () => {
    const { router } = renderProjects();
    await screen.findByRole("heading", { name: "Dashboard" });

    router.navigate("/elsewhere");

    expect(await screen.findByText("Please wait...")).toBeInTheDocument();
  });
});
