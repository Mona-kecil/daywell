export const DEV_ISSUER = "https://daywell.dev.local";
export const DEV_AUDIENCE = "daywell-dev";
export const DEV_USER = "dev-user";
export const DEV_COOKIE = "daywell-dev-session";

export function devAuthConfigured() {
  return process.env.NODE_ENV !== "production" && process.env.DEV_AUTH === "1";
}
