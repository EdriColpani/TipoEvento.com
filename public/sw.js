// Service Worker para PWA
const CACHE_NAME = 'validator-v2-scope';
const urlsToCache = [
  '/',
  '/validator',
  '/manifest.json'
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Ativação do Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Só intercepta GET do app em rotas do validador — não mexe em /events/, /manager/, navegação nem Supabase (evita erro "Failed to convert value to 'Response'").
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    event.request.method !== 'GET' ||
    event.request.mode === 'navigate' ||
    url.pathname.startsWith('/events/') ||
    url.pathname.startsWith('/manager/')
  ) {
    return;
  }

  if (url.pathname.includes('/functions/v1/') || url.hostname.includes('supabase.co')) {
    return;
  }

  const isValidatorScope =
    url.pathname === '/' || url.pathname === '/validator' || url.pathname.startsWith('/validator/');
  if (!isValidatorScope) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return new Response('Sem conexão. Recarregue quando estiver online.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        });
      })
  );
});

