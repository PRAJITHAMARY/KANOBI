import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync } from "crypto";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { createTokenVerifier, tokenFromHeader } from "../../src/local/tokenVerifier";

const ISSUER = "http://localhost:9229/local_kanobi";
const CLIENT = "kanobilocalwebclient";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A signed ID token; override claims to make it invalid. */
const token = (claims: Record<string, unknown> = {}, signer = privateKey) => {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64({ alg: "RS256", kid: "k1", typ: "JWT" }) +
    "." +
    b64({ sub: "u1", iss: ISSUER, aud: CLIENT, token_use: "id", iat: now, exp: now + 60, ...claims });
  const signature = createSign("RSA-SHA256").update(unsigned).sign(signer).toString("base64url");
  return `${unsigned}.${signature}`;
};

let server: Server;
let jwksStatus: number;
let jwksRequests: number;

beforeEach(async () => {
  jwksStatus = 200;
  jwksRequests = 0;
  server = createServer((_req, res) => {
    jwksRequests++;
    res.writeHead(jwksStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((done) => server.listen(0, done));
  vi.stubEnv("COGNITO_ISSUER", ISSUER);
  vi.stubEnv("COGNITO_CLIENT_ID", CLIENT);
  vi.stubEnv(
    "COGNITO_JWKS_URI",
    `http://localhost:${(server.address() as AddressInfo).port}/jwks.json`
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((done) => server.close(done));
});

describe("createTokenVerifier", () => {
  it("returns the claims of a valid ID token and downloads the key set once", async () => {
    const verify = createTokenVerifier()!;

    await expect(verify(token())).resolves.toMatchObject({ sub: "u1", token_use: "id" });
    await expect(verify(token({ sub: "u2" }))).resolves.toMatchObject({ sub: "u2" });
    expect(jwksRequests).toBe(1);
  });

  it.each([
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["another issuer", { iss: "http://localhost:9229/other_pool" }],
    ["another client", { aud: "someone-else" }],
    ["an access token", { token_use: "access" }],
  ])("rejects %s", async (_case, claims) => {
    await expect(createTokenVerifier()!(token(claims))).rejects.toThrow();
  });

  it("rejects a token signed with another key", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    await expect(createTokenVerifier()!(token({}, other))).rejects.toThrow();
  });

  it("retries the key set download after a failure", async () => {
    const verify = createTokenVerifier()!;
    jwksStatus = 503;
    await expect(verify(token())).rejects.toThrow("JWKS request failed: 503");

    jwksStatus = 200;
    await expect(verify(token())).resolves.toMatchObject({ sub: "u1" });
    expect(jwksRequests).toBe(2);
  });

  it("defaults the key set URL to the issuer's", async () => {
    vi.stubEnv("COGNITO_JWKS_URI", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(createTokenVerifier()!(token())).rejects.toThrow("offline");
    expect(fetchSpy).toHaveBeenCalledWith(`${ISSUER}/.well-known/jwks.json`);
  });

  it.each(["COGNITO_ISSUER", "COGNITO_CLIENT_ID"])(
    "is not available without %s",
    (name) => {
      vi.stubEnv(name, "");
      expect(createTokenVerifier()).toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "CREATETOKENVERIFIER",
        "COGNITO_ISSUER or COGNITO_CLIENT_ID is not set: secured routes will return 401"
      );
    }
  );
});

describe("tokenFromHeader", () => {
  it.each([
    ["abc", "abc"],
    ["Bearer abc", "abc"],
    ["bearer   abc ", "abc"],
    [["abc", "def"], "abc"],
    [undefined, undefined],
    ["", undefined],
    ["Bearer ", undefined],
    ["Bearer", undefined],
  ])("%j -> %j", (header, expected) => {
    expect(tokenFromHeader(header as any)).toBe(expected);
  });
});
