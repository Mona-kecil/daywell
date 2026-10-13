// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { disablePush, enablePush, pushSupport } from "../lib/push-client";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function browser(permission = "default") {
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: vi.fn(async () => "granted"),
  });
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  const sub = {
    endpoint: "https://fcm.googleapis.com/x",
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/x",
      keys: { p256dh: "key", auth: "auth" },
    }),
    unsubscribe: vi.fn(async () => true),
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async (): Promise<typeof sub | null> => sub),
      subscribe: vi.fn(async () => sub),
    },
  };
  const serviceWorker = {
    register: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
    getRegistration: vi.fn(async () => registration),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });
  return { sub, registration, serviceWorker };
}
it("reports browser permission and Home Screen requirements", () => {
  browser("denied");
  expect(pushSupport()).toBe("denied");
  browser("granted");
  expect(pushSupport()).toBe("granted");
  browser();
  expect(pushSupport()).toBe("default");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
  expect(pushSupport()).toBe("needs-install");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  expect(pushSupport()).toBe("default");
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: false,
  });
  expect(pushSupport()).toBe("unsupported");
});
it("registers the service worker and saves an existing subscription", async () => {
  const { registration, serviceWorker } = browser();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "AQID");
  const subscribe = vi.fn(async () => "id");
  const result = await enablePush(subscribe);
  expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js");
  expect(subscribe).toHaveBeenCalledWith(result);
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
});
it("creates a subscription with the VAPID bytes and rolls it back on a failed save", async () => {
  const { sub, registration } = browser();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "AQID");
  registration.pushManager.getSubscription.mockResolvedValueOnce(null);
  await expect(
    enablePush(async () => {
      throw new Error("RPC failed");
    }),
  ).rejects.toThrow("RPC failed");
  expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array([1, 2, 3]),
  });
  expect(sub.unsubscribe).toHaveBeenCalledOnce();
});
it("removes the server subscription before unsubscribing the browser and retains it if RPC fails", async () => {
  const { sub } = browser();
  await expect(
    disablePush(async () => {
      throw new Error("RPC failed");
    }),
  ).rejects.toThrow("RPC failed");
  expect(sub.unsubscribe).not.toHaveBeenCalled();
  const unsubscribe = vi.fn(async () => undefined);
  await disablePush(unsubscribe);
  expect(unsubscribe).toHaveBeenCalledWith({ endpoint: sub.endpoint });
  expect(sub.unsubscribe).toHaveBeenCalledOnce();
});
it("rejects missing configuration and denied permission", async () => {
  browser();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
  await expect(enablePush(vi.fn())).rejects.toThrow("configured");
  browser("denied");
  await expect(enablePush(vi.fn())).rejects.toThrow("browser settings");
});
