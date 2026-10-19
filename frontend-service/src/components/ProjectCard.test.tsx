import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ProjectCard from "./ProjectCard";
import { renderWithRouter } from "../test/utils";

const project = { id: "1", name: "shop", description: "Online shop", stackName: "service-1" };

const renderCard = (actionResult: unknown = { success: true }, cardProject = project) => {
  const submissions: Record<string, FormDataEntryValue>[] = [];
  const result = renderWithRouter(
    [
      {
        path: "/project",
        element: <ProjectCard project={cardProject} />,
        action: async ({ request }) => {
          submissions.push(Object.fromEntries(await request.formData()));
          return actionResult;
        },
      },
      { path: "/project/:id", element: <p>details page</p> },
    ],
    ["/project"]
  );
  const icon = (name: string) =>
    result.container.querySelector(`.lucide-${name}`) as SVGElement;
  return { ...result, submissions, icon };
};

describe("ProjectCard", () => {
  it("shows the project and links to its details", async () => {
    renderCard();

    expect(screen.getByText("Online shop")).toBeInTheDocument();
    expect(screen.getByText("service-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link"));
    expect(await screen.findByText("details page")).toBeInTheDocument();
  });

  it("exposes the edit and delete icons as named buttons", async () => {
    renderCard();

    expect(screen.getByTestId("project-card")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit project" }));
    expect(screen.getByRole("heading", { name: "Edit Project" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(screen.getByRole("heading", { name: "Delete shop" })).toBeInTheDocument();
  });

  it("edits the project and closes the dialog on success", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("clipboard-pen"));
    const name = screen.getByPlaceholderText("Project name");
    expect(name).toHaveValue("shop");

    await userEvent.clear(name);
    await userEvent.type(name, "store");
    await userEvent.clear(screen.getByPlaceholderText("description"));
    await userEvent.type(screen.getByPlaceholderText("description"), "New desc");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toEqual({
      name: "store",
      description: "New desc",
      id: "1",
      action: "put",
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Edit Project" })).not.toBeInTheDocument()
    );
  });

  it("keeps the edit dialog open with the API error, and clears it when reopened", async () => {
    const { icon, submissions } = renderCard({
      success: false,
      action: "put",
      id: "1",
      error: "name: taken",
    });

    fireEvent.click(icon("clipboard-pen"));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("name: taken");
    expect(screen.getByRole("heading", { name: "Edit Project" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(icon("clipboard-pen"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores update errors for other projects", async () => {
    const { icon, submissions } = renderCard({
      success: false,
      action: "put",
      id: "2",
      error: "name: taken",
    });

    fireEvent.click(icon("clipboard-pen"));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(screen.getByRole("heading", { name: "Edit Project" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for a valid name before updating a project saved under the old rules", async () => {
    const { icon, submissions } = renderCard(undefined, { ...project, name: "My Shop" });

    fireEvent.click(icon("clipboard-pen"));
    const name = screen.getByRole("textbox", { name: "Project name" });
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(name).toHaveAccessibleDescription(
      "Project name can only contain lowercase letters, numbers and hyphens"
    );
    expect(submissions).toEqual([]);

    await userEvent.clear(name);
    await userEvent.type(name, "my-shop");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({ name: "my-shop" });
  });

  it("closes the edit dialog from Cancel and ✕", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("clipboard-pen"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Edit Project" })).not.toBeInTheDocument();
    // Cancel is type="button", so it never submits the form.
    expect(submissions).toEqual([]);

    fireEvent.click(icon("clipboard-pen"));
    await userEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByRole("heading", { name: "Edit Project" })).not.toBeInTheDocument();
    expect(submissions).toEqual([]);
  });

  it("submits a delete after confirmation", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("x"));
    expect(screen.getByRole("heading", { name: "Delete shop" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Proceed" }));

    await waitFor(() => expect(submissions).toEqual([{ projectId: "1", action: "delete" }]));
    expect(screen.queryByRole("heading", { name: "Delete shop" })).not.toBeInTheDocument();
  });

  it("closes the delete dialog from Close and ✕ without submitting", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("x"));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Delete shop" })).not.toBeInTheDocument();

    fireEvent.click(icon("x"));
    await userEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByRole("heading", { name: "Delete shop" })).not.toBeInTheDocument();
    expect(submissions).toEqual([]);
  });
});
