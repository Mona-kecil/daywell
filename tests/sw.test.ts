import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
const source = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
type WorkerEvent = {
  data: { json(): unknown };
  notification: { close(): void; data: { url: string } };
  waitUntil(p: Promise<unknown>): void;
};
function worker() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const client = {
    url: "https://daywell.test/",
    focus: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
  };
  const self = {
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) =>
      handlers.set(name, handler),
    registration: { showNotification: vi.fn(async () => undefined) },
    location: { origin: "https://daywell.test" },
    clients: {
      matchAll: vi.fn(async () => [client]),
      openWindow: vi.fn(async () => undefined),
    },
  };
  runInNewContext(source, { self, URL });
  const dispatch = async (
    kind: string,
    value: unknown,
    url = "/?tab=meals",
  ) => {
    const promises: Promise<unknown>[] = [];
    const event = {
      data: { json: () => value },
      notification: { close: vi.fn(), data: { url } },
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
    };
    const handler = handlers.get(kind);
    if (!handler) throw new Error("Missing worker handler");
    handler(event);
    await Promise.all(promises);
    return event;
  };
  return { self, client, dispatch };
}
it("shows the slot-tagged notification and ignores malformed payloads", async () => {
  const { self, dispatch } = worker();
  await dispatch("push", {
    title: "Add protein",
    body: "Try yogurt",
    slot: "2026-10-14/13:00",
    kind: "food",
  });
  expect(self.registration.showNotification).toHaveBeenCalledWith(
    "Add protein",
    {
      body: "Try yogurt",
      icon: "/icons/icon-192.png",
      tag: "2026-10-14/13:00",
      data: { url: "/?tab=meals" },
    },
  );
  await dispatch("push", { body: "bad" });
  expect(self.registration.showNotification).toHaveBeenCalledOnce();
});
it("closes the notification and navigates/focuses the existing app or opens a window", async () => {
  const { self, client, dispatch } = worker();
  const event = await dispatch("notificationclick", null);
  expect(event.notification.close).toHaveBeenCalledOnce();
  expect(client.navigate).toHaveBeenCalledWith(
    "https://daywell.test/?tab=meals",
  );
  expect(client.focus).toHaveBeenCalledOnce();
  self.clients.matchAll.mockResolvedValueOnce([]);
  await dispatch("notificationclick", null, "/?tab=water");
  expect(self.clients.openWindow).toHaveBeenCalledWith(
    "https://daywell.test/?tab=water",
  );
});
