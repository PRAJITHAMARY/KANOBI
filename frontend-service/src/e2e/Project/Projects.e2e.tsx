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

  test("explains an invalid name and creates the project once it is fixed", async ({
    page,
    api,
    uniqueName,
  }) => {
    const name = uniqueName("fixed");
    const invalid = `My Project ${name}`;
    await login(page);

    await page.getByRole("button", { name: "New" }).click();
    const input = page.getByRole("textbox", { name: "Project name" });
    await expect(input).toHaveAccessibleDescription(
      "Lowercase letters, numbers and hyphens, 3+ characters."
    );

    await input.fill(invalid);
    await input.blur();
    await expect(input).toHaveAccessibleDescription(
      "Project name can only contain lowercase letters, numbers and hyphens"
    );
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { name: "New Project" })).toBeVisible();

    await input.fill(name);
    await expect(input).not.toHaveAttribute("aria-invalid");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("heading", { name: "New Project" })).toBeHidden();
    await expect(page.getByTestId("project-card").filter({ hasText: name })).toBeVisible();
    await api.trackProjectByName(name);
    expect(await api.findProjectsByName(invalid)).toEqual([]);
  });

  test("closes the New dialog on Cancel without creating anything", async ({
    page,
    api,
    uniqueName,
  }) => {
    const name = uniqueName("cancelled");
    await login(page);

    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill(name);
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "New Project" })).toBeHidden();
    await expect(page.getByTestId("project-card").filter({ hasText: name })).toHaveCount(0);
    expect(await api.findProjectsByName(name)).toEqual([]);
  });

  test("the API refuses names that could inject commands", async ({ api }) => {
    for (const name of ["x; rm -rf /", "$(whoami)", "Shop\nphases:"]) {
      const res = await api.tryCreateProject(name);
      expect(res.status, name).toBe(400);
      expect(res.message).toBe(
        "name: Project name can only contain lowercase letters, numbers and hyphens"
      );
    }
  });
});
