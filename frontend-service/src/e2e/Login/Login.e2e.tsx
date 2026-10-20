import { DEMO_USER, expect, login, test } from "../support/fixtures";

test.describe("Sign in", () => {
  test("shows a banner for a wrong password and stays signed out", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(DEMO_USER.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // Still signed out: the dashboard sends us back to Sign in.
    await page.goto("/project");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("takes a signed-in user to the dashboard and signs out", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText(DEMO_USER.email)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.goto("/project");
    await expect(page).toHaveURL(/\/\?redirectTo=%2Fproject$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("returns to the requested page after signing in", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Deeplink"));

    await page.goto(`/project/${project.id}`);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByLabel("Email").fill(DEMO_USER.email);
    await page.getByLabel("Password").fill(DEMO_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
  });

  test("sends a user whose session can't be renewed back to Sign in", async ({ page }) => {
    await login(page);
    // Break both tokens, as if the session had expired and been revoked.
    await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem("kanobi.session")!);
      sessionStorage.setItem(
        "kanobi.session",
        JSON.stringify({ ...session, idToken: "expired", refreshToken: "revoked" })
      );
    });

    await page.reload();

    await expect(page).toHaveURL(/\/\?expired=1$/);
    await expect(page.getByRole("status")).toHaveText("Your session has expired. Sign in again.");
  });
});
