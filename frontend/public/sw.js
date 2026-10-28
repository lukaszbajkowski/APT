// Minimalny service worker: pozwala zainstalować aplikację na telefonie. Niczego nie zapisuje w pamięci
// podręcznej – dokumenty i dane osobowe zawsze idą prosto z serwera.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
