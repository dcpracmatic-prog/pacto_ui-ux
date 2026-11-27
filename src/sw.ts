import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

interface SwManifestEntry {
  url: string;
  revision: string | null;
}

interface SwWindowClient {
  postMessage: (message: unknown) => void;
}

interface SwExtendableEvent extends Event {
  waitUntil: (promise: Promise<unknown>) => void;
}

interface SwSyncEvent extends SwExtendableEvent {
  tag: string;
}

interface SwMessageEvent extends Event {
  data?: { type?: string };
}

declare global {
  interface Window {
    __WB_MANIFEST?: Array<SwManifestEntry | string>;
  }
}

interface SwGlobalScope {
  skipWaiting: () => Promise<void>;
  clients: {
    claim: () => Promise<void>;
    matchAll: (options?: { type?: string; includeUncontrolled?: boolean }) => Promise<SwWindowClient[]>;
  };
  addEventListener: (
    type: string,
    listener: (event: Event) => void
  ) => void;
}

const sw = self as unknown as SwGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST ?? []);

// Offline SPA shell fallback for cached session viewing (skip /api/* routes)
try {
  const navHandler = createHandlerBoundToURL('/index.html');
  const navRoute = new NavigationRoute(navHandler, {
    denylist: [/^\/api\//],
  });
  registerRoute(navRoute);
} catch {
  // In dev mode before precache manifest is populated, fallback stays passive
}

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-stylesheets',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    url.pathname.startsWith('/assets/'),
  new StaleWhileRevalidate({
    cacheName: 'pacto-static-assets',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

sw.addEventListener('install', () => {
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  const extEvent = event as SwExtendableEvent;
  extEvent.waitUntil(sw.clients.claim());
});

sw.addEventListener('message', (event) => {
  const msgEvent = event as SwMessageEvent;
  if (msgEvent.data?.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

sw.addEventListener('sync', (event) => {
  const syncEvent = event as SwSyncEvent;
  if (syncEvent.tag === 'sync-pacto-incidents') {
    syncEvent.waitUntil(
      sw.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({ type: 'PACTO_SYNC_INCIDENTS' });
          }
        })
    );
  }
});
