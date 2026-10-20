import { expect, login, test } from "../support/fixtures";

test.describe("Project card", () => {
  test("edits a project's name and description", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Before"));
    const renamed = uniqueName("After");
    await login(page);

    const card = page.getByTestId("project-card").filter({ hasText: project.name });
    await card.getByRole("button", { name: "Edit project" }).click();
    await expect(page.getByRole("heading", { name: "Edit Project" })).toBeVisible();
    await page.getByPlaceholder("Project name").fill(renamed);
    await page.getByPlaceholder("description").fill("Updated in the UI");
    await page.getByRole("button", { name: "Update" }).click();

    const updated = page.getByTestId("project-card").filter({ hasText: renamed });
    await expect(updated).toContainText("Updated in the UI");
    await expect
      .poll(async () => (await api.getProject(project.id)).project?.name)
      .toBe(renamed);
  });

  test("refuses an invalid new name and keeps the old one", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Keepname"));
    await login(page);

    const card = page.getByTestId("project-card").filter({ hasText: project.name });
    await card.getByRole("button", { name: "Edit project" }).click();
    const input = page.getByRole("textbox", { name: "Project name" });
    await input.fill("Not Valid");
    await page.getByRole("button", { name: "Update" }).click();

    await expect(input).toHaveAccessibleDescription(
      "Project name can only contain lowercase letters, numbers and hyphens"
    );
    await expect(page.getByRole("heading", { name: "Edit Project" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Edit Project" })).toBeHidden();
    await expect(card).toBeVisible();
    expect((await api.getProject(project.id)).project.name).toBe(project.name);
  });

  test("deletes a project after confirmation", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Doomed"));
    await login(page);

    const card = page.getByTestId("project-card").filter({ hasText: project.name });
    await card.getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByRole("heading", { name: `Delete ${project.name}` })).toBeVisible();
    await page.getByRole("button", { name: "Proceed" }).click();

    await expect(card).toHaveCount(0);
    await expect.poll(async () => (await api.getProject(project.id)).status).toBe(404);
  });

  test("keeps the project when deletion is cancelled", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Kept"));
    await login(page);

    const card = page.getByTestId("project-card").filter({ hasText: project.name });
    await card.getByRole("button", { name: "Delete project" }).click();
    await page.getByRole("button", { name: "Close" }).click();

    await expect(page.getByRole("heading", { name: `Delete ${project.name}` })).toBeHidden();
    await expect(card).toBeVisible();
    expect((await api.getProject(project.id)).status).toBe(200);
  });

  test("opens the project's details page", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Linked"), "Details please");
    await login(page);

    await page
      .getByTestId("project-card")
      .filter({ hasText: project.name })
      .getByRole("link")
      .click();

    await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
    await expect(page.getByRole("heading", { name: project.name, level: 1 })).toBeVisible();
    await expect(page.getByText("Details please")).toBeVisible();
  });
});
