import type { AuthConfig } from "convex/server";
const clientId = process.env.WORKOS_CLIENT_ID;
export default {
  // An unconfigured local deployment has no accepted issuers. It cannot accept
  // authenticated requests until the owner supplies a real WorkOS Client ID.
  providers: clientId ? [
    { type: "customJwt", issuer: "https://api.workos.com/", algorithm: "RS256", jwks: `https://api.workos.com/sso/jwks/${clientId}`, applicationID: clientId },
    { type: "customJwt", issuer: `https://api.workos.com/user_management/${clientId}`, algorithm: "RS256", jwks: `https://api.workos.com/sso/jwks/${clientId}` },
  ] : [],
} satisfies AuthConfig;
