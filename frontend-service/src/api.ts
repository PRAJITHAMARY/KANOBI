import { API_URL } from "./config";
import { getIdToken, refreshSession, signOut } from "./auth";

/** Where a user whose session can't be renewed is sent. */
export const SESSION_EXPIRED_PATH = "/?expired=1";

/**
 * fetch for the Kanobi API: adds the signed-in user's ID token and, for
 * requests with a body, the JSON content type. On a 401 for a signed-in user it
 * renews the token once and retries; if that fails it signs out and opens the
 * Sign in page with the "session expired" notice.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const token = getIdToken();
    if (token) headers.Authorization = token;
    return fetch(`${API_URL}${path}`, { ...init, headers });
  };

  let response = await send();
  // Signed out: nothing to renew. Route loaders run in parallel with the
  // requireAuth guard, which sends the user to Sign in itself.
  if (response.status !== 401 || !getIdToken()) return response;

  if (await refreshSession()) {
    response = await send();
  }
  if (response.status === 401) {
    signOut();
    window.location.assign(SESSION_EXPIRED_PATH);
  }
  return response;
}
