import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ProjectCard from "./ProjectCard";
import { renderWithRouter } from "../test/utils";

const project = { id: "1", name: "Shop", description: "Online shop", stackName: "service-1" };

const renderCard = (actionResult: unknown = { success: true }) => {
  const submissions: Record<string, FormDataEntryValue>[] = [];
  const result = renderWithRouter(
    [
      {
        path: "/project",
        element: <ProjectCard project={project} />,
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
    expect(screen.getByRole("heading", { name: "Delete Shop" })).toBeInTheDocument();
  });

  it("edits the project and closes the dialog on success", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("clipboard-pen"));
    const name = screen.getByPlaceholderText("Project name");
    expect(name).toHaveValue("Shop");

    await userEvent.clear(name);
    await userEvent.type(name, "Store");
    await userEvent.clear(screen.getByPlaceholderText("description"));
    await userEvent.type(screen.getByPlaceholderText("description"), "New desc");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toEqual({
      name: "Store",
      description: "New desc",
      id: "1",
      action: "put",
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Edit Project" })).not.toBeInTheDocument()
    );
  });

  it("keeps the edit dialog open when the update fails", async () => {
    const { icon, submissions } = renderCard({ success: false });

    fireEvent.click(icon("clipboard-pen"));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(screen.getByRole("heading", { name: "Edit Project" })).toBeInTheDocument();
  });

  it("closes the edit dialog from Cancel and ✕", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("clipboard-pen"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Edit Project" })).not.toBeInTheDocument();
    // Documents current behaviour: Cancel has no type="button", so it also submits the form.
    await waitFor(() =>
      expect(submissions).toEqual([{ name: "Shop", description: "Online shop", id: "1" }])
    );

    fireEvent.click(icon("clipboard-pen"));
    await userEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByRole("heading", { name: "Edit Project" })).not.toBeInTheDocument();
  });

  it("submits a delete after confirmation", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("x"));
    expect(screen.getByRole("heading", { name: "Delete Shop" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Proceed" }));

    await waitFor(() => expect(submissions).toEqual([{ projectId: "1", action: "delete" }]));
    expect(screen.queryByRole("heading", { name: "Delete Shop" })).not.toBeInTheDocument();
  });

  it("closes the delete dialog from Close and ✕ without submitting", async () => {
    const { icon, submissions } = renderCard();

    fireEvent.click(icon("x"));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Delete Shop" })).not.toBeInTheDocument();

    fireEvent.click(icon("x"));
    await userEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByRole("heading", { name: "Delete Shop" })).not.toBeInTheDocument();
    expect(submissions).toEqual([]);
  });
});
