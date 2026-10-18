import { expect, test } from "../support/fixtures";

test.describe("Model manager", () => {
  test("adds a model to a project", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Models"));
    await page.goto(`/project/${project.id}`);

    await page.getByPlaceholder("Model name", { exact: true }).fill("Customer");
    await page.getByPlaceholder("Description (optional)").fill("People who buy");
    await page.getByRole("button", { name: "Add Model" }).click();

    const card = page.getByTestId("model-card");
    await expect(card).toHaveCount(1);
    await expect(card.getByPlaceholder("Model Name", { exact: true })).toHaveValue("Customer");
    await expect(card.getByText("No properties defined.")).toBeVisible();
    await expect(page.getByPlaceholder("Model name", { exact: true })).toHaveValue("");

    const [model] = await api.getModels(project.id);
    expect(model).toMatchObject({ name: "Customer" });
    expect(model.apis.every((a) => a.generate)).toBe(true);
  });

  test("defines properties and APIs, then pushes the update", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("Props"));
    await api.createModel(project.id, "Order");
    await page.goto(`/project/${project.id}`);

    const card = page.getByTestId("model-card");
    await expect(card.getByRole("button", { name: "Push Update" })).toBeDisabled();

    await card.getByRole("button", { name: "+ Add Property" }).click();
    await card.getByPlaceholder("Property name").fill("total");
    await card.getByRole("combobox").first().selectOption("number");
    await card.getByRole("row", { name: /total/ }).getByRole("checkbox").check();
    // Stop generating the bulk-delete endpoint.
    await card.getByLabel("deletemultiple").uncheck();

    await card.getByRole("button", { name: "Push Update" }).click();

    // Push Update reloads the page; the edits must survive the round trip.
    await expect(card.getByPlaceholder("Property name")).toHaveValue("total");
    await expect(card.getByRole("combobox").first()).toHaveValue("number");
    await expect(card.getByLabel("deletemultiple")).not.toBeChecked();
    await expect(card.getByRole("button", { name: "Push Update" })).toBeDisabled();

    const [model] = await api.getModels(project.id);
    expect(model.properties).toEqual([{ name: "total", type: "number", required: true }]);
    expect(model.apis.find((a) => a.method === "deletemultiple")?.generate).toBe(false);
    expect(model.apis.find((a) => a.method === "get")?.generate).toBe(true);
  });

  test("deletes a model", async ({ page, api, uniqueName }) => {
    const project = await api.createProject(uniqueName("DelModel"));
    await api.createModel(project.id, "Invoice");
    await page.goto(`/project/${project.id}`);

    const card = page.getByTestId("model-card");
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "Delete Model" }).click();

    await expect(card).toHaveCount(0);
    await expect.poll(async () => (await api.getModels(project.id)).length).toBe(0);
  });
});
