// Service worker: instalacja aplikacji na telefonie, powiadomienia push i strona „Przerwa techniczna”.
// W pamięci podręcznej jest wyłącznie statyczna strona offline.html (bez danych) – dokumenty i dane osobowe
// zawsze idą prosto z serwera. Powiadomienia mają ogólną treść.
const OFFLINE_CACHE = "apt-offline-v2";
const OFFLINE_URL = "/offline.html";
// krój Golos Text dla strony offline (ten sam wygląd co w aplikacji, także bez połączenia)
const OFFLINE_FONTS = [400, 600, 800].flatMap((w) => [`/fonts/golos-text-latin-${w}-normal.woff2`, `/fonts/golos-text-latin-ext-${w}-normal.woff2`]);
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((c) => c.addAll([OFFLINE_URL, ...OFFLINE_FONTS].map((u) => new Request(u, { cache: "reload" }))))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
// serwer nie odpowiada przy otwieraniu strony (aktualizacja, restart, awaria, brak internetu) – zamiast błędu
// przeglądarki pokazujemy wyjaśnienie, która sama sprawdza, czy aplikacja wróciła
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // czcionki strony offline: z pamięci, gdy serwer nie odpowiada
  if (req.method === "GET" && new URL(req.url).pathname.startsWith("/fonts/golos-text-")) {
    event.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || Response.error())));
    return;
  }
  if (req.mode !== "navigate" || req.method !== "GET") return;
  event.respondWith(
    fetch(req).then(
      (res) => (res.status === 502 || res.status === 503 || res.status === 504 ? caches.match(OFFLINE_URL).then((r) => r || res) : res),
      () => caches.match(OFFLINE_URL).then((r) => r || Response.error()),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Identyfikacja APT";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
      tag: data.url || "apt",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
