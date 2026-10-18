import { acceptNextDialog, expect, test } from "../support/fixtures";

// Builds and deploys the generated service to LocalStack (npm install, tsc,
// serverless deploy), so this flow takes a few minutes.
test.describe("Project details: deployment", () => {
  // A retry would cost several more minutes; a failed build fails fast below instead.
  test.describe.configure({ timeout: 10 * 60_000, retries: 0 });

  test("deploys a project and serves its generated API", async ({ page, api, uniqueName, request }) => {
    const project = await api.createProject(uniqueName("Deploy"), "Deployed by e2e");
    await api.createModel(project.id, "Product", [
      { name: "title", type: "string", required: true },
      { name: "price", type: "number", required: false },
    ]);
    await page.goto(`/project/${project.id}`);
    await expect(page.getByRole("heading", { name: project.name, level: 1 })).toBeVisible();

    const alert = acceptNextDialog(page);
    await page.getByRole("button", { name: "Deploy changes" }).click();
    expect(await alert).toBe("Redeployment in progress... Refresh page to see logs");

    // Wait for the build through the API so a failed build fails the test right
    // away, with the build log in the message, instead of timing out.
    await expect
      .poll(async () => (await api.getDeployment(project.id)).buildComplete, {
        message: "the build should complete",
        timeout: 8 * 60_000,
        intervals: [5_000],
      })
      .toBe(true);
    const deployment = await api.getDeployment(project.id);
    expect(deployment.buildStatus, `build log:\n${deployment.log}`).toBe("SUCCEEDED");

    // Swagger only shows up on the poll after the build succeeds, so reload
    // until the page has caught up.
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("SUCCEEDED", { exact: true })).toBeVisible({ timeout: 2_000 });
      await expect(page.getByText("API Documentation", { exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000, intervals: [5_000] });

    await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
    await expect(page.getByText("Build and Deployment log")).toBeVisible();
    await expect(page.getByText(/Service deployed to stack/)).toBeVisible();
    const swagger = page.locator(".swagger-ui");
    // Operation summaries read "METHOD path description".
    await expect(swagger.getByRole("button", { name: /^GET \/Product / })).toBeVisible();
    await expect(swagger.getByRole("button", { name: /^POST \/Product / })).toBeVisible();
    await expect(swagger.getByRole("button", { name: /^GET \/Product\/\{id\} / })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deploy changes" })).toBeEnabled();

    // The deployed Lambdas really serve the generated CRUD API.
    const { baseUrl } = await api.getDeployment(project.id);
    expect(baseUrl).toMatch(/\.execute-api\.localhost\.localstack\.cloud:4566\/prod$/);

    const created = await request.post(`${baseUrl}/Product`, {
      data: { title: "Lamp", price: 25 },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()).data;

    const listed = await request.get(`${baseUrl}/Product`);
    expect(listed.ok()).toBe(true);
    expect((await listed.json()).data).toContainEqual({ id, title: "Lamp", price: 25 });
  });
});
