import { expect, login, test } from "../support/fixtures";

test.describe("Login", () => {
  test("rejects invalid credentials with an alert", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill("wrong");

    const dialog = page.waitForEvent("dialog");
    await page.getByRole("button", { name: "Login" }).click();
    const alert = await dialog;
    expect(alert.message()).toBe("Invalid credentials");
    await alert.accept();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  });

  test("takes valid users to the dashboard", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
