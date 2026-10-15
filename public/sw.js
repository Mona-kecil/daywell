self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  if (!data || typeof data.title !== "string" || typeof data.body !== "string")
    return;
  const tabs = {
    water: "water",
    food: "meals",
    train: "train",
    rest: "train",
    cardio: "train",
  };
  const tab = tabs[data.kind];
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      tag: data.slot,
      data: { url: tab ? `/?tab=${tab}` : "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  );
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(url.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
