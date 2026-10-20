import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelManager from "./modelManager";
import { API, jsonResponse } from "../test/utils";

const apis = [
  { method: "get", generate: true },
  { method: "post", generate: false },
];

const makeProject = () => ({
  id: "p1",
  name: "Shop",
  description: "",
  models: [
    {
      id: "m1",
      name: "User",
      entityType: "Model",
      description: "Users",
      apis,
      properties: [
        { name: "email", type: "string" as const, required: true },
        { name: "age", type: "number" as const, required: false },
      ],
      relations: [{ modelId: "m2", relatedModel: "Post", relationship: "one-to-many" }],
    },
    {
      id: "m2",
      name: "Post",
      entityType: "Model",
      description: "",
      apis,
      properties: [],
      relations: [],
    },
    {
      id: "m3",
      name: "Tag",
      entityType: "Model",
      description: "",
      apis,
      properties: [],
      // Older models may have no relations array at all.
      relations: undefined as unknown as [],
    },
  ],
});

type Route = { method: string; url: string; ok?: boolean; body?: unknown };

/** Stub fetch; responds per "METHOD url" with ok (default true) and body. */
const stubFetch = (routes: Route[] = []) => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.url === url && r.method === (init?.method ?? "GET"));
    return route?.ok === false
      ? jsonResponse({ message: "error" }, 500)
      : jsonResponse(route?.body ?? {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const sentBody = (fetchMock: ReturnType<typeof stubFetch>, url: string, method: string) =>
  JSON.parse(
    fetchMock.mock.calls.find(([u, init]) => u === url && init?.method === method)![1]!
      .body as string
  );

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
});

const renderManager = (isDeploying = false) => {
  const result = render(<ModelManager project={makeProject()} isDeploying={isDeploying} />);
  const card = (name: string) =>
    (screen.getAllByPlaceholderText("Model Name") as HTMLInputElement[])
      .find((input) => input.value === name)!
      .closest(".space-y-4.border") as HTMLElement;
  return { ...result, card };
};

describe("ModelManager rendering", () => {
  it("renders each model with its APIs, properties and relations", () => {
    const { card } = renderManager();

    const user = within(card("User"));
    expect(user.getByDisplayValue("Users")).toBeInTheDocument();
    expect(user.getByRole("checkbox", { name: "get" })).toBeChecked();
    expect(user.getByRole("checkbox", { name: "post" })).not.toBeChecked();
    expect(user.getByDisplayValue("email")).toBeInTheDocument();
    expect(user.getByDisplayValue("number")).toBeInTheDocument();
    expect(user.getByRole("button", { name: "Push Update" })).toBeDisabled();

    // The relation model picker lists every other model.
    const [modelSelect] = user.getAllByRole("combobox").slice(-2);
    expect(within(modelSelect).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "",
      "Post",
      "Tag",
    ]);
    expect(modelSelect).toHaveValue("m2");

    expect(within(card("Post")).getByText("No properties defined.")).toBeInTheDocument();
    expect(within(card("Post")).getByText("No relationship defined")).toBeInTheDocument();
    expect(within(card("Tag")).queryByText("No relationship defined")).not.toBeInTheDocument();
  });

  it("disables deploying while a deployment runs", () => {
    renderManager(true);
    expect(screen.getByRole("button", { name: "Deploy changes" })).toBeDisabled();
  });
});

describe("adding and deleting models", () => {
  it("creates a model and clears the form", async () => {
    const created = {
      id: "m9",
      name: "Order",
      entityType: "Model",
      description: "Orders",
      apis,
      properties: [],
      relations: [],
    };
    const fetchMock = stubFetch([
      { method: "POST", url: `${API}/model/p1`, body: { data: created } },
    ]);
    renderManager();

    const add = screen.getByRole("button", { name: "Add Model" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Model name"), "  Order ");
    await userEvent.type(screen.getByPlaceholderText("Description (optional)"), " Orders ");
    await userEvent.click(add);

    expect(await screen.findByDisplayValue("Order")).toBeInTheDocument();
    expect(sentBody(fetchMock, `${API}/model/p1`, "POST")).toEqual({
      name: "Order",
      description: "Orders",
      properties: [],
    });
    expect(screen.getByPlaceholderText("Model name")).toHaveValue("");
    expect(screen.getByPlaceholderText("Description (optional)")).toHaveValue("");
  });

  it("keeps the form when creation fails", async () => {
    stubFetch([{ method: "POST", url: `${API}/model/p1`, ok: false }]);
    renderManager();

    await userEvent.type(screen.getByPlaceholderText("Model name"), "Order");
    await userEvent.click(screen.getByRole("button", { name: "Add Model" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("error");
    expect(screen.getByPlaceholderText("Model name")).toHaveValue("Order");
  });

  it.each([
    ["order", "Model name must be PascalCase: start with a capital letter, then letters and numbers only"],
    ["Order Item", "Model name must be PascalCase: start with a capital letter, then letters and numbers only"],
    ["POST", "Model name is already used"],
  ])("explains why %j can't be added", async (name, message) => {
    const fetchMock = stubFetch();
    renderManager();
    const input = screen.getByRole("textbox", { name: "New model name" });
    expect(input).toHaveAccessibleDescription("PascalCase, e.g. Product or OrderItem.");

    await userEvent.type(input, name);

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(message);
    expect(screen.getByRole("button", { name: "Add Model" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes a deleted model", async () => {
    const fetchMock = stubFetch();
    const { card } = renderManager();

    await userEvent.click(within(card("Post")).getByRole("button", { name: "Delete Model" }));

    await waitFor(() => expect(screen.getAllByPlaceholderText("Model Name")).toHaveLength(2));
    expect(screen.queryByText("No relationship defined")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${API}/model/p1/m2`, { method: "DELETE", headers: {} });
    expect(screen.getByDisplayValue("User")).toBeInTheDocument();
  });

  it("keeps a model whose deletion fails", async () => {
    stubFetch([{ method: "DELETE", url: `${API}/model/p1/m2`, ok: false }]);
    const { card } = renderManager();

    await userEvent.click(within(card("Post")).getByRole("button", { name: "Delete Model" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getAllByPlaceholderText("Model Name")).toHaveLength(3);
  });
});

describe("editing a model", () => {
  it("marks a model as changed when its name or description is edited", async () => {
    const { card } = renderManager();
    const user = within(card("User"));

    fireEvent.change(user.getByDisplayValue("Users"), { target: { value: "All users" } });
    expect(user.getByRole("button", { name: "Push Update" })).toBeEnabled();
    expect(within(card("Post")).getByRole("button", { name: "Push Update" })).toBeDisabled();

    fireEvent.change(screen.getAllByPlaceholderText("Model Name")[0], {
      target: { value: "Member" },
    });
    expect(screen.getByDisplayValue("Member")).toBeInTheDocument();
  });

  it("toggles API generation for one model only", async () => {
    const { card } = renderManager();

    await userEvent.click(within(card("User")).getByRole("checkbox", { name: "post" }));

    expect(within(card("User")).getByRole("checkbox", { name: "post" })).toBeChecked();
    expect(within(card("User")).getByRole("checkbox", { name: "get" })).toBeChecked();
    expect(within(card("Post")).getByRole("checkbox", { name: "post" })).not.toBeChecked();
  });

  it("adds, edits and deletes properties", async () => {
    const { card } = renderManager();
    const user = within(card("User"));

    await userEvent.click(user.getByRole("button", { name: "+ Add Property" }));
    const names = user.getAllByPlaceholderText("Property name");
    expect(names).toHaveLength(3);
    expect(names[2]).toHaveValue("");

    fireEvent.change(names[2], { target: { value: "nickname" } });
    const typeSelects = user.getAllByRole("combobox").slice(0, 3);
    fireEvent.change(typeSelects[2], { target: { value: "boolean" } });
    const required = user.getAllByRole("checkbox").slice(apis.length);
    await userEvent.click(required[2]);

    expect(user.getByDisplayValue("nickname")).toBeInTheDocument();
    expect(typeSelects[2]).toHaveValue("boolean");
    expect(required[2]).toBeChecked();
    expect(typeSelects[0]).toHaveValue("string");

    await userEvent.click(user.getAllByRole("button", { name: "Delete" })[0]);
    expect(user.queryByDisplayValue("email")).not.toBeInTheDocument();
    expect(user.getByDisplayValue("age")).toBeInTheDocument();
    expect(within(card("Post")).getByText("No properties defined.")).toBeInTheDocument();
  });

  it("adds and edits relationships", async () => {
    const { card } = renderManager();

    // Tag starts without a relations array.
    await userEvent.click(within(card("Tag")).getByRole("button", { name: "+ Add Relationship" }));
    await userEvent.click(within(card("User")).getByRole("button", { name: "+ Add Relationship" }));

    const userSelects = within(card("User")).getAllByRole("combobox");
    // property types (2), then [model, type] per relation (2 relations)
    const [, , , , newModel, newType] = userSelects;
    fireEvent.change(newModel, { target: { value: "m3" } });
    fireEvent.change(newType, { target: { value: "many-to-many" } });

    expect(newModel).toHaveValue("m3");
    expect(newType).toHaveValue("many-to-many");
    expect(userSelects[2]).toHaveValue("m2");
    expect(within(card("Tag")).getAllByRole("combobox")).toHaveLength(2);
  });
});

describe("validating a model", () => {
  it("shows a row error for an invalid or duplicate model name and blocks saving", async () => {
    const { card } = renderManager();
    const user = within(card("User"));
    const name = user.getByPlaceholderText("Model Name");

    fireEvent.change(name, { target: { value: "user account" } });
    expect(name).toHaveAccessibleDescription(
      "Model name must be PascalCase: start with a capital letter, then letters and numbers only"
    );
    expect(user.getByRole("button", { name: "Push Update" })).toBeDisabled();

    fireEvent.change(name, { target: { value: "Post" } });
    expect(name).toHaveAccessibleDescription("Model name is already used");
    expect(user.getByRole("button", { name: "Push Update" })).toBeDisabled();

    fireEvent.change(name, { target: { value: "Member" } });
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(user.getByRole("button", { name: "Push Update" })).toBeEnabled();
  });

  it("shows a row error for an invalid or duplicate field name and blocks saving", async () => {
    const { card } = renderManager();
    const user = within(card("User"));

    await userEvent.click(user.getByRole("button", { name: "+ Add Property" }));
    const [email, , added] = user.getAllByPlaceholderText("Property name");
    expect(added).toHaveAccessibleDescription("Field name is required");
    expect(user.getByRole("button", { name: "Push Update" })).toBeDisabled();

    fireEvent.change(added, { target: { value: "Email" } });
    expect(added).toHaveAccessibleDescription(
      "Field name must be camelCase: start with a lowercase letter, then letters and numbers only"
    );

    // Both rows of a case-insensitive duplicate are flagged.
    fireEvent.change(added, { target: { value: "eMail" } });
    expect(added).toHaveAccessibleDescription("Field name is already used");
    expect(email).toHaveAccessibleDescription("Field name is already used");

    fireEvent.change(added, { target: { value: "nickname" } });
    expect(added).not.toHaveAttribute("aria-invalid");
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(user.getByRole("button", { name: "Push Update" })).toBeEnabled();
  });
});

describe("saving changes", () => {
  it("pushes the model, its APIs and its relations, then reloads", async () => {
    const fetchMock = stubFetch();
    const { card } = renderManager();
    const user = within(card("User"));

    fireEvent.change(user.getByDisplayValue("Users"), { target: { value: "All users" } });
    await userEvent.click(user.getByRole("button", { name: "Push Update" }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(sentBody(fetchMock, `${API}/model/p1/m1`, "PUT")).toEqual({
      name: "User",
      description: "All users",
      properties: [
        { name: "email", type: "string", required: true },
        { name: "age", type: "number", required: false },
      ],
    });
    expect(sentBody(fetchMock, `${API}/model-api/p1/m1`, "PUT")).toEqual({ apis });
    expect(sentBody(fetchMock, `${API}/model-relations/p1/m1`, "POST")).toEqual({
      relations: [{ modelId: "m2", relationship: "one-to-many" }],
    });
    expect(user.getByRole("button", { name: "Push Update" })).toBeDisabled();
  });

  // Found by the e2e suite: models that never had relations have no relations
  // array, and pushing them threw before the relations POST and the reload.
  it("pushes a model without a relations array and reloads", async () => {
    const fetchMock = stubFetch();
    const { card } = renderManager();
    const tag = within(card("Tag"));

    await userEvent.click(tag.getByRole("button", { name: "+ Add Property" }));
    fireEvent.change(tag.getByPlaceholderText("Property name"), { target: { value: "label" } });
    await userEvent.click(tag.getByRole("button", { name: "Push Update" }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(sentBody(fetchMock, `${API}/model/p1/m3`, "PUT").properties).toEqual([
      { name: "label", type: "string", required: false },
    ]);
    expect(sentBody(fetchMock, `${API}/model-relations/p1/m3`, "POST")).toEqual({
      relations: [],
    });
  });

  it.each([
    ["the model update", `${API}/model/p1/m1`],
    ["the API update", `${API}/model-api/p1/m1`],
  ])("does not reload when %s fails", async (_label, url) => {
    stubFetch([{ method: "PUT", url, ok: false }]);
    const { card } = renderManager();
    const user = within(card("User"));

    fireEvent.change(user.getByDisplayValue("Users"), { target: { value: "x" } });
    await userEvent.click(user.getByRole("button", { name: "Push Update" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(await user.findByRole("alert")).toHaveTextContent("error");
    expect(reload).not.toHaveBeenCalled();
    expect(user.getByRole("button", { name: "Push Update" })).toBeEnabled();
    expect(within(card("Post")).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("deletes a relationship and reloads", async () => {
    const fetchMock = stubFetch();
    const { card } = renderManager();

    const deleteButtons = within(card("User")).getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(sentBody(fetchMock, `${API}/model-relations/p1/m1`, "PUT")).toEqual({
      relations: [{ modelId: "m2", modelName: "Post", relationship: "one-to-many" }],
    });
  });

  it("does not reload when deleting a relationship fails", async () => {
    stubFetch([{ method: "PUT", url: `${API}/model-relations/p1/m1`, ok: false }]);
    const { card } = renderManager();

    const deleteButtons = within(card("User")).getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  it("redeploys the project", async () => {
    const fetchMock = stubFetch();
    renderManager();

    await userEvent.click(screen.getByRole("button", { name: "Deploy changes" }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledWith("Redeployment in progress... Refresh page to see logs");
    expect(sentBody(fetchMock, `${API}/deployment`, "PUT")).toEqual({ projectId: "p1" });
  });

  it("shows why the redeploy request failed", async () => {
    stubFetch([{ method: "PUT", url: `${API}/deployment`, ok: false }]);
    renderManager();

    await userEvent.click(screen.getByRole("button", { name: "Deploy changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("error");
    expect(alert).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
