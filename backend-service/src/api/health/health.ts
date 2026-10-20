import { ResponseManager } from "../../utils/responseManager";

/** Public liveness check (no authorizer), used by health checks and e2e setup. */
export async function Health(): Promise<any> {
  return ResponseManager.OkResponse({ status: "ok" });
}
