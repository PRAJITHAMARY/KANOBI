import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL } from "../../../playwright.config";

export { expect };

export interface Property {
  name: string;
  type: string;
  required: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
}

export interface Model {
  id: string;
  name: string;
  apis: { method: string; generate: boolean }[];
  properties: Property[];
}

/**
 * Talks to the Kanobi API directly, for test setup, assertions and cleanup.
 * Every project created (or tracked) through it is deleted after the test.
 */
export class KanobiApi {
  private readonly projectIds = new Set<string>();
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async createProject(name: string, description = "Created by e2e"): Promise<Project> {
    const res = await this.request.post(`${API_URL}/project`, { data: { name, description } });
    expect(res.status(), await res.text()).toBe(201);
    const project = (await res.json()).data as Project;
    this.projectIds.add(project.id);
    return project;
  }

  async createModel(projectId: string, name: string, properties: Property[] = []): Promise<Model> {
    const res = await this.request.post(`${API_URL}/model/${projectId}`, {
      data: { name, properties },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data as Model;
  }

  async getProject(id: string) {
    const res = await this.request.get(`${API_URL}/project/${id}`);
    return { status: res.status(), project: res.ok() ? (await res.json()).data : undefined };
  }

  async getModels(projectId: string): Promise<Model[]> {
    const res = await this.request.get(`${API_URL}/model/${projectId}`);
    expect(res.ok()).toBe(true);
    return (await res.json()).data;
  }

  async getDeployment(projectId: string) {
    const res = await this.request.get(`${API_URL}/deployment/${projectId}`);
    expect(res.ok()).toBe(true);
    return (await res.json()).data;
  }

  /** Finds a project created through the UI and schedules it for cleanup. */
  async trackProjectByName(name: string): Promise<Project> {
    const res = await this.request.get(`${API_URL}/project?take=1000`);
    const projects = (await res.json()).data as Project[];
    const project = projects.find((p) => p.name === name);
    expect(project, `project "${name}" should exist`).toBeDefined();
    this.projectIds.add(project!.id);
    return project!;
  }

  async cleanup() {
    for (const id of this.projectIds) {
      // Already deleted by the test (404) is fine.
      await this.request.delete(`${API_URL}/project/${id}`);
    }
  }
}

type Fixtures = {
  api: KanobiApi;
  /** A name no other test (or earlier run) uses, e.g. "Shop w0-lq3x9a". */
  uniqueName: (prefix: string) => string;
};

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    const api = new KanobiApi(request);
    await use(api);
    await api.cleanup();
  },
  // eslint-disable-next-line no-empty-pattern
  uniqueName: async ({}, use, testInfo) => {
    let n = 0;
    await use(
      (prefix) =>
        `${prefix} w${testInfo.workerIndex}-${Date.now().toString(36)}${n++}`
    );
  },
});

/**
 * Accepts the next alert/confirm and resolves with its message. Register it
 * *before* the action that opens the dialog: the dialog blocks the page, so an
 * action like click() may not finish until the dialog is handled, and awaiting
 * the click first deadlocks.
 */
export function acceptNextDialog(page: Page): Promise<string> {
  return new Promise((resolve, reject) => {
    page.once("dialog", (dialog) => {
      dialog.accept().then(() => resolve(dialog.message()), reject);
    });
  });
}

/** Logs in through the login form (credentials are checked client-side). */
export async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Password").fill("password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/project$/);
}
