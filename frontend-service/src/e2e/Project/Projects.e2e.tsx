import { expect, login, test } from "../support/fixtures";

test.describe("Projects dashboard", () => {
  test("lists existing projects", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Listed"), "Shown on the dashboard");

    await login(page);

    const card = page.getByTestId("project-card").filter({ hasText: project.name });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Shown on the dashboard");
  });

  test("creates a project from the New dialog", async ({ page, api, uniqueName }) => {
    const name = uniqueName("Created");
    await login(page);

    await page.getByRole("button", { name: "New" }).click();
    await expect(page.getByRole("heading", { name: "New Project" })).toBeVisible();
    await page.getByPlaceholder("Project name").fill(name);
    await page.getByPlaceholder("description").fill("Made in the UI");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("heading", { name: "New Project" })).toBeHidden();
    const card = page.getByTestId("project-card").filter({ hasText: name });
    await expect(card).toContainText("Made in the UI");

    // The project-created handler names the generated service's stack.
    const project = await api.trackProjectByName(name);
    await page.reload();
    await expect(card).toContainText(/service-[0-9A-F]{6}-formation/);
    expect((await api.getProject(project.id)).project.stackName).toMatch(/-formation$/);
  });
});
