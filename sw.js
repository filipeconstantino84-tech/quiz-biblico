// ═══════════════════════════════════════════════════════
// OVELHA INTELIGENTE — Service Worker
// Estratégia: Network-first para o jogo (precisa de WebSocket
// em tempo real), com cache do shell estático para arranque
// rápido e suporte a instalação (PWA).
// ═══════════════════════════════════════════════════════

const CACHE_NAME   = 'ovelha-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Fontes do Google (cacheadas na primeira visita)
  'https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;600;700;800;900&display=swap',
];

// ── Install: pré-cachear o shell ────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Usar individual adds para não falhar tudo se uma fonte não carregar
      return Promise.allSettled(
        SHELL_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  // Activar imediatamente sem esperar por tabs antigas
  self.skipWaiting();
});

// ── Activate: limpar caches antigas ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Tomar controlo imediato de todas as tabs abertas
  self.clients.claim();
});

// ── Fetch: Network-first com fallback para cache ─────────
// Rotas WebSocket (ws://, wss://) nunca passam pelo SW
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar: WebSockets, requests de outras origens que não sejam fontes
  if (
    request.url.startsWith('ws://') ||
    request.url.startsWith('wss://') ||
    (url.origin !== self.location.origin &&
     !url.hostname.includes('fonts.googleapis.com') &&
     !url.hostname.includes('fonts.gstatic.com'))
  ) {
    return; // deixar o browser tratar normalmente
  }

  // API de jogo (/api/*) — sempre network, nunca cachear
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Tudo o resto: network-first, fallback para cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Guardar uma cópia fresca no cache (só respostas bem sucedidas)
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Sem rede → servir do cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Fallback final: servir o index.html (SPA shell)
          return caches.match('/index.html');
        });
      })
  );
});

// ── Mensagem de controlo (ex: forçar update) ────────────
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
