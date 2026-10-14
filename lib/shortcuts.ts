export function convexSiteUrl(convexUrl: string): string {
  const url = new URL(convexUrl);
  if (url.protocol === "https:" && url.hostname.endsWith(".convex.cloud")) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    return url.toString().replace(/\/$/, "");
  }
  if (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port &&
    Number(url.port) < 65535
  ) {
    url.port = String(Number(url.port) + 1);
    return url.toString().replace(/\/$/, "");
  }
  return convexUrl;
}
