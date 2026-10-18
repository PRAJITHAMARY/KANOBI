import { acceptNextDialog, expect, login, test } from "../support/fixtures";

test.describe("Login", () => {
  test("rejects invalid credentials with an alert", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill("wrong");

    const alert = acceptNextDialog(page);
    await page.getByRole("button", { name: "Login" }).click();
    expect(await alert).toBe("Invalid credentials");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  });

  test("takes valid users to the dashboard", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
