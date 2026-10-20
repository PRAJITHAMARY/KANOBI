import { API_URL } from "../../../playwright.config";
import { expect, login, OTHER_USER, test } from "../support/fixtures";

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

  test("users only see their own projects", async ({ page, api, otherApi, uniqueName }) => {
    const mine = await api.createProject(uniqueName("Private"));
    const theirs = await otherApi.createProject(uniqueName("Theirs"));

    await login(page, OTHER_USER);
    await expect(page.getByTestId("project-card").filter({ hasText: theirs.name })).toBeVisible();
    await expect(page.getByTestId("project-card").filter({ hasText: mine.name })).toHaveCount(0);

    // Another user's project looks like it doesn't exist, and can't be changed.
    expect((await otherApi.getProject(mine.id)).status).toBe(404);
    expect(await otherApi.findProjectsByName(mine.name)).toEqual([]);
    expect((await api.getProject(mine.id)).status).toBe(200);
  });

  test("the API refuses requests without a valid token", async ({ request }) => {
    expect((await request.get(`${API_URL}/project`)).status()).toBe(401);
    const forged = await request.get(`${API_URL}/project`, {
      headers: { Authorization: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0." },
    });
    expect(forged.status()).toBe(401);
    expect((await request.get(`${API_URL}/health`)).status()).toBe(200);
  });
});
