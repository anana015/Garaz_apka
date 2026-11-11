// Service worker (rozdz. 3, „Offline”): pliki aplikacji w pamięci podręcznej.
// Dane z Supabase NIE są tu buforowane – kopię ostatnio pobranych danych trzyma db.js w IndexedDB.
//
// Strategia:
//  - kod i style (HTML, JS, CSS): najpierw sieć, bez sieci kopia – po wdrożeniu nowej wersji
//    telefon od razu dostaje nowy kod, bez mieszania starych i nowych plików;
//  - czcionki, ikony, biblioteki z numerem wersji w nazwie: najpierw kopia (nie zmieniają się).
// Po dodaniu pliku do aplikacji dopisz go do PLIKI (pilnuje tego tests/pwa.test.js)
// i podnieś WERSJA, żeby stara pamięć podręczna została usunięta.

const WERSJA = 'najem-0.18.2';
const LIMIT_SIECI_MS = 4000;   // słaby zasięg: po 4 s pokaż kopię, jeśli jest

const PLIKI = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/csv.js',
  'js/banki.js',
  'js/bramy.js',
  'js/rozpoznanie.js',
  'js/rozliczenia.js',
  'js/zadania.js',
  'js/statystyki.js',
  'js/podatek.js',
  'js/kopia.js',
  'js/eksport.js',
  'js/dane.js',
  'js/db.js',
  'js/formularz.js',
  'js/koszty.js',
  'js/mapa.js',
  'js/okresy.js',
  'js/promocje.js',
  'js/startowe.js',
  'js/state.js',
  'js/ui.js',
  'js/umowy.js',
  'js/utils.js',
  'js/walidacja.js',
  'js/views/bramy.js',
  'js/views/edycja.js',
  'js/views/import.js',
  'js/views/jednostki.js',
  'js/views/klienci.js',
  'js/views/koszty.js',
  'js/views/logowanie.js',
  'js/views/najmy.js',
  'js/views/przypomnienie.js',
  'js/views/pulpit.js',
  'js/views/raporty.js',
  'js/views/zadania.js',
  'js/views/startowe.js',
  'js/views/umowy.js',
  'js/views/ustawienia.js',
  'js/views/wplaty.js',
  'js/views/wspolne.js',
  'js/vendor/supabase-2.119.0.js',
  'js/vendor/jszip-3.10.1.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/bricolage-grotesque-latin-wght-normal.woff2',
  'fonts/bricolage-grotesque-latin-ext-wght-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-ext-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'fonts/ibm-plex-mono-latin-ext-500-normal.woff2',
  'fonts/source-sans-3-latin-400-normal.woff2',
  'fonts/source-sans-3-latin-ext-400-normal.woff2',
  'fonts/source-sans-3-latin-600-normal.woff2',
  'fonts/source-sans-3-latin-ext-600-normal.woff2',
  'fonts/source-sans-3-latin-700-normal.woff2',
  'fonts/source-sans-3-latin-ext-700-normal.woff2',
];

const NIEZMIENNE = /\/(fonts|icons|js\/vendor)\//;

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(WERSJA).then((c) => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const klucze = await caches.keys();
    await Promise.all(klucze.filter((k) => k !== WERSJA).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function zKopii(zadanie) {
  const kopia = await caches.match(zadanie, { ignoreSearch: true });
  if (kopia) return kopia;
  // Nawigacja do dowolnego adresu w aplikacji bez sieci: pokaż szkielet aplikacji.
  if (zadanie.mode === 'navigate') return caches.match('index.html');
  return undefined;
}

async function najpierwKopia(zadanie) {
  const kopia = await caches.match(zadanie);
  if (kopia) return kopia;
  const odpowiedz = await fetch(zadanie);
  if (odpowiedz.ok) (await caches.open(WERSJA)).put(zadanie, odpowiedz.clone());
  return odpowiedz;
}

async function najpierwSiec(zadanie) {
  const zSieci = fetch(zadanie).then(async (odpowiedz) => {
    if (odpowiedz.ok) (await caches.open(WERSJA)).put(zadanie, odpowiedz.clone());
    return odpowiedz;
  });
  zSieci.catch(() => {});   // gdy wygrała kopia, późny błąd sieci nie jest już ważny
  const limit = new Promise((ok) => { setTimeout(ok, LIMIT_SIECI_MS); });
  try {
    const wynik = await Promise.race([zSieci, limit.then(() => zKopii(zadanie))]);
    return wynik ?? await zSieci;   // brak kopii – czekaj dalej na sieć
  } catch {
    const kopia = await zKopii(zadanie);
    if (kopia) return kopia;
    throw new Error('Brak sieci i brak kopii pliku');
  }
}

self.addEventListener('fetch', (ev) => {
  const { request } = ev;
  const url = new URL(request.url);
  // Tylko pliki aplikacji. Supabase (inny adres) i zapisy (POST, PATCH) idą prosto do sieci.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  ev.respondWith(NIEZMIENNE.test(url.pathname) ? najpierwKopia(request) : najpierwSiec(request));
});
