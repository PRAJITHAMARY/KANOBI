import { COGNITO_CLIENT_ID, COGNITO_ENDPOINT } from "./config";

// Sign-in against Cognito's JSON API (USER_PASSWORD_AUTH). The session lives in
// sessionStorage, so it ends with the tab and is not shared between tabs.

export type Session = {
  email: string;
  idToken: string;
  refreshToken: string;
};

const SESSION_KEY = "kanobi.session";

/** Wrong email or password (Cognito doesn't say which). */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
  }
}

const CREDENTIAL_ERRORS = [
  "NotAuthorizedException",
  "UserNotFoundException",
  "InvalidPasswordException",
];

type CognitoResult = {
  AuthenticationResult?: { IdToken: string; RefreshToken?: string };
  ChallengeName?: string;
  __type?: string;
  message?: string;
};

const initiateAuth = async (body: object) => {
  const response = await fetch(COGNITO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({ ClientId: COGNITO_CLIENT_ID, ...body }),
  });
  return { ok: response.ok, data: (await response.json()) as CognitoResult };
};

export function getSession(): Session | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : undefined;
  } catch {
    return undefined;
  }
}

const saveSession = (session: Session) =>
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

export const getIdToken = () => getSession()?.idToken;

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { ok, data } = await initiateAuth({
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });

  if (!ok) {
    const type = data.__type?.split("#").pop() ?? "";
    if (CREDENTIAL_ERRORS.includes(type)) throw new InvalidCredentialsError();
    throw new Error(data.message || "Sign in failed. Try again.");
  }

  const result = data.AuthenticationResult;
  if (!result?.RefreshToken) {
    // e.g. NEW_PASSWORD_REQUIRED for a user an admin created without a permanent password.
    throw new Error(
      "This account can't sign in yet. Ask an admin to set a permanent password."
    );
  }

  const session = { email, idToken: result.IdToken, refreshToken: result.RefreshToken };
  saveSession(session);
  return session;
}

/** Gets a new ID token with the refresh token; false when the session can't be renewed. */
export async function refreshSession(): Promise<boolean> {
  const session = getSession();
  if (!session) return false;

  try {
    const { ok, data } = await initiateAuth({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    if (!ok || !data.AuthenticationResult) return false;

    saveSession({ ...session, idToken: data.AuthenticationResult.IdToken });
    return true;
  } catch {
    return false;
  }
}
