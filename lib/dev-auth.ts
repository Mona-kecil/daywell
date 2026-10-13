import { importJWK, SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { DEV_AUDIENCE, DEV_ISSUER, DEV_USER } from "./dev-auth-config";

const privateJwkSchema = z.object({
  kty: z.literal("RSA"),
  n: z.string(),
  e: z.string(),
  d: z.string(),
  p: z.string(),
  q: z.string(),
  dp: z.string(),
  dq: z.string(),
  qi: z.string(),
  kid: z.string(),
});
const sessionAudience = `${DEV_AUDIENCE}-session`;
function privateJwk() {
  return privateJwkSchema.parse(
    JSON.parse(process.env.DEV_AUTH_PRIVATE_JWK ?? "null"),
  );
}
export async function signDevToken(session = false) {
  const jwk = privateJwk();
  return new SignJWT({ name: "Dev User" })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setSubject(DEV_USER)
    .setIssuer(DEV_ISSUER)
    .setAudience(session ? sessionAudience : DEV_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(session ? "8h" : "5m")
    .sign(await importJWK(jwk, "RS256"));
}
export async function validDevSession(token: string) {
  const { n, e, kty } = privateJwk();
  try {
    const { payload } = await jwtVerify(
      token,
      await importJWK({ n, e, kty }, "RS256"),
      {
        issuer: DEV_ISSUER,
        audience: sessionAudience,
        algorithms: ["RS256"],
      },
    );
    return payload.sub === DEV_USER;
  } catch {
    return false;
  }
}
