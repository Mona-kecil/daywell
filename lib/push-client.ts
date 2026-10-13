export type PushSupport =
  "unsupported" | "needs-install" | "denied" | "default" | "granted";
export type SubscribeArgs = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type SubscribeMutation = (args: SubscribeArgs) => Promise<unknown>;
export type UnsubscribeMutation = (args: {
  endpoint: string;
}) => Promise<unknown>;
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true);
  if (ios && !standalone) return "needs-install";
  if (
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return "unsupported";
  return Notification.permission;
}
function applicationKey(key: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}
export async function enablePush(
  subscribeMutation: SubscribeMutation,
): Promise<SubscribeArgs> {
  const support = pushSupport();
  if (support === "needs-install")
    throw new Error("Install Daywell on your Home Screen to enable reminders.");
  if (support === "unsupported")
    throw new Error("Push reminders are unavailable in this browser.");
  if (support === "denied")
    throw new Error("Allow notifications in your browser settings.");
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("Push reminders are not configured.");
  // Call from a user click: permission prompts must retain the browser's user gesture.
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationKey(key),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
    throw new Error("Browser returned an incomplete push subscription.");
  const args = {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
  try {
    await subscribeMutation(args);
  } catch (error) {
    if (!existing) await subscription.unsubscribe();
    throw error;
  }
  return args;
}
export async function disablePush(
  unsubscribeMutation: UnsubscribeMutation,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  // Remove the server record first so a failed RPC can be retried using the browser endpoint.
  await unsubscribeMutation({ endpoint: subscription.endpoint });
  if (!(await subscription.unsubscribe()))
    throw new Error("Could not unsubscribe this browser. Please retry.");
}
