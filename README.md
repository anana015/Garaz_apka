# Najem magazynów

Aplikacja PWA do śledzenia czynszów za jednostki magazynowe: kto zapłacił, kto zalega, ile wpłynęło i ile ryczałtu zapłacić. Specyfikacja: „Najem magazynów – specyfikacja” v0.1 (projekt „Magazyny – apka, obsługa”).

**Stan:** szkielet etapu 1 – powłoka aplikacji, logowanie, 5 zakładek, schemat bazy z RLS, PWA – oraz wyliczanie okresów i należności (`js/okresy.js`, testy akceptacyjne 1–3). Salda, ryczałt i formularze powstają w krokach 1a–1d (rozdział 15 specyfikacji).

## Uruchomienie lokalne

Aplikacja to statyczne pliki – wystarczy dowolny serwer HTTP (moduły ES nie działają z `file://`):

```bash
python3 -m http.server 8080      # albo: npm start
```

Otwórz <http://localhost:8080>. Bez konfiguracji Supabase aplikacja działa w **trybie podglądu**: pokazuje interfejs bez danych i bez logowania.

## Konfiguracja Supabase (jednorazowo)

1. Załóż projekt w Supabase (region UE, np. Frankfurt).
2. W **SQL Editor** uruchom cały plik `supabase/schema.sql`. Tworzy 14 tabel, RLS na każdej z nich i prywatny bucket `umowy` na PDF-y.
3. W **Authentication**:
   - wyłącz zakładanie nowych kont (sign-ups) – aplikacja ma jednego użytkownika,
   - dodaj użytkownika (e-mail i hasło) w zakładce **Users**,
   - w **URL Configuration** wpisz adres aplikacji jako *Site URL* i dodaj go do *Redirect URLs* (potrzebne do linku logowania).
4. W **Project Settings → API** skopiuj adres projektu i klucz publiczny (`anon` albo `sb_publishable_…`) do `js/config.js`.
   **Nigdy** nie wpisuj tam klucza `service_role` – ochronę danych daje RLS (rozdział 11).

## Testy

```bash
npm install     # jednorazowo: PGlite do testów schematu
npm test        # Node 22+
```

| Plik | Co sprawdza |
| --- | --- |
| `tests/utils.test.js` | kwoty w groszach, daty (Z5, strefa Europe/Warsaw), normalizacja nazw, walidacja NIP, telefonu, e-maila i rachunku |
| `tests/okresy.test.js` | okresy i należności: testy akceptacyjne 1–3, niepełny pierwszy okres (Z7), koniec najmu (Z8), najem sprzed `data_start` (Z34), okresy 3-miesięczne, korekty, rok przestępny |
| `tests/dane.test.js` | indeksy danych, najem w dniu, stawka na dzień, wpłaty do przypisania, próg Raportów |
| `tests/schema.test.js` | `supabase/schema.sql` na prawdziwym PostgreSQL (PGlite): RLS, brak dostępu dla `anon`, test akceptacyjny 16 (nakładające się najmy), ograniczenia, bucket |
| `tests/pwa.test.js` | każdy plik aplikacji jest w pamięci podręcznej `sw.js`, manifest, odwołania w `index.html`, importy modułów |

## Wdrożenie

Wgraj katalog (bez `node_modules/` i `tests/`) na GitHub Pages, Netlify albo Cloudflare Pages. Przy każdym wdrożeniu, które dodaje lub usuwa pliki, zaktualizuj listę `PLIKI` i podnieś `WERSJA` w `sw.js` (test `pwa.test.js` wykryje pominięty plik).

## Struktura

```
index.html, manifest.webmanifest, sw.js
css/app.css            zmienne kolorów (12.4), komponenty, tryb ciemny, układ ≥ 900 px
js/config.js           adres Supabase, stałe (progi terminowości, typy jednostek, ustawienia domyślne)
js/state.js            jeden obiekt stanu
js/app.js              start, router (#/ekran/id), render(), delegacja zdarzeń
js/db.js               jedyny moduł rozmawiający z Supabase (logowanie, pobieranie)
js/dane.js             indeksy i proste zapytania na pobranych danych (czyste funkcje)
js/okresy.js           okresy rozliczeniowe i należności z najmów (5.1, czyste funkcje)
js/utils.js            kwoty, daty, tekst, walidacja (czyste funkcje)
js/ui.js               ikony, komunikat (toast), puste stany, filtry
js/views/              pulpit, wplaty, klienci (z kartą klienta), jednostki (ze szczegółami),
                       raporty, import, ustawienia, logowanie, wspolne
js/vendor/             supabase-js 2.119.0 (UMD, ładowany dopiero po konfiguracji)
fonts/                 Bricolage Grotesque, Source Sans 3, IBM Plex Mono (OFL 1.1, lokalnie)
icons/                 ikony PWA 192, 512, maskable, apple-touch-icon, SVG
supabase/schema.sql    schemat bazy
tests/                 node --test
```

Moduły z rozdziału 3, które dojdą w kolejnych krokach: `csv.js`, `banki.js`, `rozliczenia.js` (1b), `statystyki.js` (1c), `podatek.js`, `wykresy.js` (1d).

## Decyzje doprecyzowujące specyfikację (9.11.2026)

| Temat | Decyzja |
| --- | --- |
| Najem sprzed `data_start` (Z34, 5.1) | Należność za okres zaczęty przed `data_start` (np. 15.12.2025–14.01.2026) jest w saldzie otwarcia klienta. Pierwsza wyliczana należność ma termin ≥ `data_start` (tu 15.01.2026). Dane z 2025 r. zostaną wczytane później – wystarczy wtedy przesunąć `data_start`, należności przeliczą się same (Z38) |
| Niepełny pierwszy okres (Z7) | Od dnia startu do dnia przed najbliższym dniem płatności. Kwota = stawka × dni ÷ dni pełnego okresu kończącego się tego samego dnia, zaokrąglona do pełnego złotego. Przykład: start 10.03, płatność 1. dnia, 300 zł → 300 × 22 ÷ 31 = 213 zł |

## Różnice względem specyfikacji

| Zmiana | Powód |
| --- | --- |
| RLS i polityka `own_rows` dla wszystkich 14 tabel, `anon` bez dostępu | SQL w specyfikacji ma politykę tylko dla `units` |
| `(select auth.uid())` w politykach | zalecenie wydajnościowe Supabase |
| `contracts.archived` | rozdz. 4 „Zasady zapisu” każe archiwizować umowy, a tabela nie miała pola |
| `settings.default_last_period` | pole z Ustawień (8.8) bez kolumny w tabeli |
| `settings.last_backup_at` | przypomnienie o kopii po 30 dniach (rozdz. 10) |
| `bank_accounts.csv_profile` | zapamiętane ręczne mapowanie kolumn (7.1) bez miejsca w bazie |
| Bucket `umowy` tworzony w skrypcie: prywatny, PDF, 10 MB | limit 10 MB z formularza 8.6 pilnowany też po stronie serwera |
| Kolory `--st-partial-text` (#8A5500) i `--st-off-text` (#5F6966) w trybie jasnym | `--st-partial` (4,43:1) i `--st-off` (3,70:1) nie spełniają WCAG AA 4,5:1 jako tekst (12.5). Wersje bazowe zostają do ikon i ramek (wymóg 3:1) |
| Czcionki i supabase-js lokalnie zamiast z CDN | działanie offline (PWA) i brak zapytań do zewnętrznych serwerów |
| Dodatkowe pliki `js/ui.js`, `js/dane.js`, `js/views/logowanie.js`, `js/views/wspolne.js` | wspólne elementy widoków i ekran logowania z rozdziału 11 |
| Karta klienta i szczegóły jednostki w `klienci.js` i `jednostki.js` (adres `#/klienci/<id>`) | jeden plik na zakładkę; specyfikacja wymienia osobne `klient.js` i `jednostka.js` |
