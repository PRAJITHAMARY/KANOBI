import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { API_URL, COGNITO_CLIENT_ID, COGNITO_URL } from "../../../playwright.config";

export { expect };

export interface User {
  email: string;
  password: string;
}

/** Users seeded in cognito-local (cognito-local/db/local_kanobi.json). */
export const DEMO_USER: User = {
  email: process.env.E2E_USER_EMAIL ?? "demo@kanobi.local",
  password: process.env.E2E_USER_PASSWORD ?? "Kanobi-demo-1",
};
export const OTHER_USER: User = {
  email: process.env.E2E_OTHER_USER_EMAIL ?? "other@kanobi.local",
  password: process.env.E2E_OTHER_USER_PASSWORD ?? "Kanobi-other-1",
};

/** Signs in to Cognito directly and returns the ID token the API expects. */
export async function idTokenFor(request: APIRequestContext, user: User): Promise<string> {
  const res = await request.post(COGNITO_URL, {
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    data: JSON.stringify({
      ClientId: COGNITO_CLIENT_ID,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: user.email, PASSWORD: user.password },
    }),
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).AuthenticationResult.IdToken;
}

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
 * Talks to the Kanobi API directly as one signed-in user, for test setup,
 * assertions and cleanup. Every project created (or tracked) through it is
 * deleted after the test.
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

  /** Sends a create request as-is; for checking what the API rejects. */
  async tryCreateProject(name: string) {
    const res = await this.request.post(`${API_URL}/project`, { data: { name } });
    const body = await res.json();
    if (res.ok()) this.projectIds.add(body.data.id);
    return { status: res.status(), message: body.message as string };
  }

  async findProjectsByName(name: string): Promise<Project[]> {
    const res = await this.request.get(`${API_URL}/project?take=1000`);
    const projects = (await res.json()).data as Project[];
    return projects.filter((p) => p.name === name);
  }

  /** Finds a project created through the UI and schedules it for cleanup. */
  async trackProjectByName(name: string): Promise<Project> {
    const [project] = await this.findProjectsByName(name);
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
  /** The API as DEMO_USER, the user `login(page)` signs in as. */
  api: KanobiApi;
  /** The API as OTHER_USER, for checking that users can't see each other's projects. */
  otherApi: KanobiApi;
  /**
   * A project name no other test (or earlier run) uses, e.g. "shop-w0-lq3x9a0".
   * It follows the project name rule: lowercase letters, numbers and hyphens.
   */
  uniqueName: (prefix: string) => string;
};

const apiFixture =
  (user: User) =>
  async (
    { playwright, request }: Pick<PlaywrightWorkerArgs, "playwright"> &
      Pick<PlaywrightTestArgs, "request">,
    use: (api: KanobiApi) => Promise<void>
  ) => {
    const context = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: await idTokenFor(request, user) },
    });
    const api = new KanobiApi(context);
    await use(api);
    await api.cleanup();
    await context.dispose();
  };

export const test = base.extend<Fixtures>({
  api: apiFixture(DEMO_USER),
  otherApi: apiFixture(OTHER_USER),
  // eslint-disable-next-line no-empty-pattern
  uniqueName: async ({}, use, testInfo) => {
    let n = 0;
    await use(
      (prefix) =>
        `${prefix.toLowerCase()}-w${testInfo.workerIndex}-${Date.now().toString(36)}${n++}`
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

/** Signs in through the Sign in page and waits for the dashboard. */
export async function login(page: Page, user: User = DEMO_USER) {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/project$/);
}
