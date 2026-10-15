import { isLocalDeployment } from "../lib/local-deployment";
import type { AuthConfig } from "convex/server";
function optionalAuthEnv(name: "WORKOS_CLIENT_ID" | "DEV_AUTH_JWKS") {
  try {
    return process.env[name];
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        `Environment variable ${name} is used in auth config file but its value was not set`,
      )
    )
      return undefined;
    throw error;
  }
}
const clientId = optionalAuthEnv("WORKOS_CLIENT_ID");
const devJwks = optionalAuthEnv("DEV_AUTH_JWKS");
export default {
  providers: [
    ...(devJwks && isLocalDeployment(process.env)
      ? [
          {
            type: "customJwt" as const,
            issuer: "https://daywell.dev.local",
            applicationID: "daywell-dev",
            algorithm: "RS256" as const,
            jwks: `data:text/plain;charset=utf-8;base64,${btoa(devJwks)}`,
          },
        ]
      : []),
    ...(clientId
      ? [
          {
            type: "customJwt" as const,
            issuer: "https://api.workos.com/",
            algorithm: "RS256" as const,
            jwks: `https://api.workos.com/sso/jwks/${clientId}`,
            applicationID: clientId,
          },
          {
            type: "customJwt" as const,
            issuer: `https://api.workos.com/user_management/${clientId}`,
            algorithm: "RS256" as const,
            jwks: `https://api.workos.com/sso/jwks/${clientId}`,
          },
        ]
      : []),
  ],
} satisfies AuthConfig;
