import { expect, test } from "@playwright/test";

test("production build returns 404 for dev routes even with DEV_AUTH=1 and a private key", async ({
  request,
}) => {
  for (const path of ["/dev-login", "/api/dev-token"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }
  expect((await request.delete("/api/dev-token")).status()).toBe(404);
});
