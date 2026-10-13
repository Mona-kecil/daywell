import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { jwtVerify, importJWK } from "jose";
import { NextRequest } from "next/server";
import { GET as login } from "../app/dev-login/route";
import { GET as token, DELETE as logout } from "../app/api/dev-token/route";
import { DEV_AUDIENCE, DEV_COOKIE, DEV_ISSUER } from "../lib/dev-auth-config";

afterEach(() => vi.unstubAllEnvs());
describe("development auth routes", () => {
  it("production returns 404 for dev login and token routes even with DEV_AUTH=1 and a key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH", "1");
    vi.stubEnv("DEV_AUTH_PRIVATE_JWK", "must never be read in production");
    expect(
      (await login(new NextRequest("http://localhost/dev-login"))).status,
    ).toBe(404);
    expect(
      (await token(new NextRequest("http://localhost/api/dev-token"))).status,
    ).toBe(404);
    expect((await logout()).status).toBe(404);
  });
  it("unconfigured development returns 404", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH", "");
    expect(
      (await login(new NextRequest("http://localhost/dev-login"))).status,
    ).toBe(404);
    expect(
      (await token(new NextRequest("http://localhost/api/dev-token"))).status,
    ).toBe(404);
  });
  it("issues a five-minute RS256 token only for a signed dev session, and clears it on logout", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH", "1");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    vi.stubEnv(
      "DEV_AUTH_PRIVATE_JWK",
      JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "test" }),
    );
    expect(
      (await token(new NextRequest("http://localhost/api/dev-token"))).status,
    ).toBe(401);
    expect(
      (
        await token(
          new NextRequest("http://localhost/api/dev-token", {
            headers: { cookie: `${DEV_COOKIE}=forged` },
          }),
        )
      ).status,
    ).toBe(401);
    const response = await login(new NextRequest("http://localhost/dev-login"));
    expect(response.headers.get("location")).toBe("http://localhost/");
    const cookie = response.cookies.get(DEV_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    const result = await token(
      new NextRequest("http://localhost/api/dev-token", {
        headers: { cookie: `${DEV_COOKIE}=${cookie?.value}` },
      }),
    );
    const body = await result.json();
    const { payload } = await jwtVerify(
      body.token,
      await importJWK(publicKey.export({ format: "jwk" }), "RS256"),
      { issuer: DEV_ISSUER, audience: DEV_AUDIENCE },
    );
    expect(payload.sub).toBe("dev-user");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const cleared = await logout();
    expect(cleared.cookies.get(DEV_COOKIE)?.maxAge).toBe(0);
  });
});
