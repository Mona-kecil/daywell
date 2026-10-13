type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

function loopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isLocalDeployment(env: DeploymentEnvironment): boolean {
  return loopbackUrl(env.CONVEX_CLOUD_URL) && loopbackUrl(env.CONVEX_SITE_URL);
}

export function fdcMode(env: DeploymentEnvironment): "fixture" | "live" {
  if (env.FDC_MODE !== "fixture") return "live";
  if (!isLocalDeployment(env))
    throw new Error(
      "FDC_MODE=fixture requires a local Convex deployment. Set FDC_MODE=live for production.",
    );
  return "fixture";
}
