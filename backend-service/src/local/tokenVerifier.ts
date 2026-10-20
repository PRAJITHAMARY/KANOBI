import { JwtRsaVerifier } from "aws-jwt-verify";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import { logWarning } from "../utils/logger";

// Local stand-in for API Gateway's Cognito authorizer: verifies a Cognito ID
// token (signature, issuer, audience, expiry) and returns its claims.
// cognito-local serves its JWKS over plain http, which aws-jwt-verify won't
// fetch itself, so the key set is downloaded once and handed to the verifier.

export type VerifyToken = (token: string) => Promise<JwtPayload>;

export const createTokenVerifier = (): VerifyToken | undefined => {
  const issuer = process.env.COGNITO_ISSUER;
  const audience = process.env.COGNITO_CLIENT_ID;
  if (!issuer || !audience) {
    logWarning(
      createTokenVerifier.name,
      "COGNITO_ISSUER or COGNITO_CLIENT_ID is not set: secured routes will return 401"
    );
    return undefined;
  }
  const jwksUri = process.env.COGNITO_JWKS_URI || `${issuer}/.well-known/jwks.json`;

  const verifier = JwtRsaVerifier.create({
    issuer,
    audience,
    customJwtCheck: ({ payload }) => {
      if (payload.token_use !== "id") throw new Error("Not an ID token");
    },
  });

  let jwksLoaded: Promise<void> | undefined;
  const loadJwks = async () => {
    const response = await fetch(jwksUri);
    if (!response.ok) throw new Error(`JWKS request failed: ${response.status}`);
    verifier.cacheJwks(await response.json());
  };

  return async (token) => {
    // Retry the download on the next request if it failed.
    jwksLoaded ??= loadJwks().catch((error) => {
      jwksLoaded = undefined;
      throw error;
    });
    await jwksLoaded;
    return verifier.verify(token);
  };
};

/** The token from an Authorization header, with or without a "Bearer " prefix. */
export const tokenFromHeader = (header: string | string[] | undefined) => {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.replace(/^Bearer(\s+|$)/i, "").trim() || undefined;
};
