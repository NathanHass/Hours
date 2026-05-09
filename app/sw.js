const CACHE = 'hours-20260509093240';
const APP_SHELL = ["/", "/index.html", "/style.css", "/app.js", "/sw.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(APP_SHELL.map(url =>
        fetch(url, { cache: 'reload' }).then(res => c.put(url, res))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Stale-while-revalidate for hours.json
  if (url.pathname.endsWith("/hours.json")) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached ?? (await fetchPromise);
      }),
    );
    return;
  }

  // Cache-first for app shell
  e.respondWith(
    caches.match(e.request).then((cached) => cached ?? fetch(e.request)),
  );
});
