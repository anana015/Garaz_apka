# Najem magazynów

Aplikacja PWA do śledzenia czynszów za jednostki magazynowe: kto zapłacił, kto zalega, ile wpłynęło i ile ryczałtu zapłacić. Specyfikacja: „Najem magazynów – specyfikacja” v0.1 (projekt „Magazyny – apka, obsługa”).

**Stan (0.11.0):** kroki 1a–1d zaimplementowane – Raporty, ryczałt kwartalny (`js/podatek.js`), eksporty CSV (`js/eksport.js`), kopia zapasowa JSON (`js/kopia.js` + funkcja `wczytaj_kopie`, migracja 004) i tryb offline (kopia ostatnio pobranych danych w IndexedDB, tylko odczyt). „Gdzie płaci” przy najmie i usuwanie wpłaty gotówką (0.7.1); prostszy widok z trybem „Edytuj” i jednostkami w Ustawieniach (0.7.2). Profile wyciągów: Nest Bank, Millennium, PKO BP, Alior; inne banki – ręczne mapowanie kolumn (0.8.0). Ręczny przelew, dzień płatności 20., wypowiedzenie, wpłata za jednostkę, ręczna kwota okresu (0.9.0). Promocje: wybór w nowym najmie, lista w Ustawieniach → Promocje (0.10.0). Boxy bez kaucji, „Dodaj kaucję” na karcie klienta, tryb „Edytuj” klienta jako zwarte ustawienia (0.11.0). Mapa placu na ekranie Jednostki – przełącznik „Lista / Mapa”, układ w `js/mapa.js` (0.16.0); statusy mapy, boxy XS/XL, eksport kosztów do CSV (0.16.1). Szczegóły: dokument „stan-kodu” w projekcie.

## Uruchomienie lokalne

Aplikacja to statyczne pliki – wystarczy dowolny serwer HTTP (moduły ES nie działają z `file://`):

```bash
python3 -m http.server 8080      # albo: npm start
```

Otwórz <http://localhost:8080>. Bez konfiguracji Supabase aplikacja działa w **trybie podglądu**: pokazuje interfejs bez danych i bez logowania.

## Konfiguracja Supabase (jednorazowo)

1. Załóż projekt w Supabase (region UE, np. Frankfurt).
2. W **SQL Editor** uruchom cały plik `supabase/schema.sql` (14 tabel, RLS na każdej, prywatny bucket `umowy` na PDF-y), a potem **po kolei każdy plik z `supabase/migracje/`**. Migracje można uruchomić ponownie bez szkody.

   | Migracja | Zawartość | Potrzebna od |
   | --- | --- | --- |
   | `001_zapisz_pakiet.sql` | 4 typy jednostek (decyzja 3), funkcja `zapisz_pakiet` (zapis kilku tabel w jednej transakcji), ograniczenia z formularzy 8.6, indeksy kluczy obcych i `user_id` | 0.2.0 – bez niej nowy najem, koniec najmu i dane startowe pokażą komunikat o brakującej funkcji |
   | `002_miejsce_platnosci.sql` | gdzie klient płaci przy najmie (przelew na konto, gotówka, FV), bank Millennium | 0.2.x |
   | `003_zadania.sql` | notatki z terminem jako zadania (`task_owner`, `done_at`) | 0.4.0 |
   | `004_wczytaj_kopie.sql` | funkcja `wczytaj_kopie` – wczytanie kopii zapasowej JSON w jednej transakcji | 0.7.0 – bez niej „Wczytaj kopię” pokaże komunikat o brakującej funkcji |
   | `005_mapowanie_csv.sql` | kolumna `bank_accounts.csv_mapping` – ręczne mapowanie kolumn wyciągu zapamiętane przy koncie | 0.8.0 – bez niej kolumny trzeba wskazywać przy każdym wyciągu |
   | `006_dzien_20_wypowiedzenie_jednostka.sql` | **raz**: wszystkie najmy płatne 20.; `settings.default_billing_day`; wypowiedzenie (`rentals.notice_given_on`, `notice_end_on`); wpłata za jednostkę (`payments.rental_id`) | 0.9.0 – bez niej nie zapiszą się ustawienia, wypowiedzenie ani „Za jednostkę” |
   | `007_promocje.sql` | lista promocji (`settings.promotions`, null = domyślna) | 0.10.0 – bez niej działa lista domyślna, ale nie da się jej zmienić |
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
| `tests/utils.test.js` | kwoty w groszach, daty (Z5, strefa Europe/Warsaw, format z Excela), normalizacja nazw, walidacja NIP, telefonu, e-maila i rachunku, odmiana liczebników, UUID |
| `tests/okresy.test.js` | okresy i należności: testy akceptacyjne 1–3, niepełny pierwszy okres (Z7), koniec najmu (Z8), najem sprzed `data_start` (Z34), okresy 3-miesięczne, korekty, rok przestępny |
| `tests/dane.test.js` | indeksy danych, najem w dniu, stawka na dzień, wpłaty do przypisania, próg Raportów, dopisywanie zapisanych wierszy do stanu |
| `tests/walidacja.test.js` | formularze 8.6: jednostka, klient, nowy najem (kolizje – test 16), PDF, zmiana stawki (Z13, test 1), podwyżka zbiorcza, koniec najmu (test 3) z kaucją (test 13), korekta, ustawienia, konto |
| `tests/csv.test.js` | odczyt CSV: Windows-1250 (test 9), BOM, separator, cudzysłowy, numeracja wierszy jak w Excelu, zapis dla Excela |
| `tests/startowe.test.js` | import danych startowych (7.5): pełny import, błędy z numerem wiersza, nakładające się najmy, ponowny import |
| `tests/db.test.js` | błędy bazy (unikalność, kolizja najmów, brak funkcji) jako komunikaty po polsku |
| `tests/schema.test.js` | `supabase/schema.sql` + migracje na prawdziwym PostgreSQL (PGlite): RLS, brak dostępu dla `anon`, test akceptacyjny 16, ograniczenia, bucket, `zapisz_pakiet` (wszystko albo nic, RLS w funkcji), ponowne uruchomienie migracji |
| `tests/mapa.test.js` | mapa placu: liczba miejsc (70 w rzędach, 15 dużych i 6 małych boxów), brak nakładania, kody G05R1 / K05R1 i boxy, jednostki poza mapą i duplikaty |
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
js/db.js               jedyny moduł rozmawiający z Supabase (logowanie, pobieranie, zapis, PDF umów)
js/dane.js             indeksy i proste zapytania na pobranych danych (czyste funkcje)
js/okresy.js           okresy rozliczeniowe i należności z najmów (5.1, czyste funkcje)
js/walidacja.js        walidacja formularzy 8.6 i budowa wierszy do zapisu (czyste funkcje)
js/csv.js              odczyt i zapis CSV: kodowanie, separator, cudzysłowy (czyste funkcje)
js/startowe.js         import danych startowych z szablonów 7.5 (czyste funkcje)
js/formularz.js        stan formularza, pola z etykietą i błędem pod polem (12.5), zapis z blokadą
js/utils.js            kwoty, daty, tekst, walidacja (czyste funkcje)
js/ui.js               ikony, komunikat (toast), puste stany, filtry
js/views/              pulpit, wplaty, klienci (karta i formularz klienta), jednostki (szczegóły i formularz),
                       najmy (nowy najem, stawka, koniec, korekta, podwyżka), ustawienia (edycja, konta),
                       startowe (dane startowe), raporty, import, logowanie, wspolne
js/vendor/             supabase-js 2.119.0 (UMD, ładowany dopiero po konfiguracji)
fonts/                 Bricolage Grotesque, Source Sans 3, IBM Plex Mono (OFL 1.1, lokalnie)
icons/                 ikony PWA 192, 512, maskable, apple-touch-icon, SVG
supabase/schema.sql    schemat bazy (stan uruchomiony w Supabase 10.11.2026)
supabase/migracje/     zmiany schematu po kolei: 001_…, 002_…
supabase/jednorazowe/  skrypty uruchamiane raz na danych (np. promocja_startowa_boxy.sql – najpierw podgląd)
tests/                 node --test
```

Adresy ekranów: `#/ekran/parametr/akcja?zapytanie`, np. `#/jednostki/nowa`, `#/klienci/<id>/edycja`, `#/najmy/nowy?jednostka=<id>`, `#/najmy/<id>/stawka`, `#/ustawienia/dane-startowe`.

Moduły z rozdziału 3, które jeszcze nie powstały: `wykresy.js` (słupki są na razie w CSS).

## Decyzje doprecyzowujące specyfikację (9.11.2026)

| Temat | Decyzja |
| --- | --- |
| Najem sprzed `data_start` (Z34, 5.1) | Należność za okres zaczęty przed `data_start` (np. 15.12.2025–14.01.2026) jest w saldzie otwarcia klienta. Pierwsza wyliczana należność ma termin ≥ `data_start` (tu 15.01.2026). Dane z 2025 r. zostaną wczytane później – wystarczy wtedy przesunąć `data_start`, należności przeliczą się same (Z38) |
| Niepełny pierwszy okres (Z7) | Od dnia startu do dnia przed najbliższym dniem płatności. Kwota = stawka × dni ÷ dni pełnego okresu kończącego się tego samego dnia, zaokrąglona do pełnego złotego. Przykład: start 10.03, płatność 1. dnia, 300 zł → 300 × 22 ÷ 31 = 213 zł |

| Typy jednostek (10.11.2026, decyzja 3) | 4 typy: `garaz`, `kontener`, `box_duzy`, `box_maly` (ograniczenie `units_type_check`). Migracja 001 ustawia je także w bazie założonej starszym schematem. W CSV typ można wpisać kluczem albo nazwą („Duży box”); samo „box” jest odrzucane jako niejednoznaczne |

## Decyzje przyjęte w kroku 1a (10.11.2026, do potwierdzenia)

| Temat | Decyzja |
| --- | --- |
| Umowa z kilkoma jednostkami | Nowy najem z numerem umowy, który ten klient już ma, dopisuje jednostkę do tamtej umowy. Bez numeru – zawsze nowa umowa |
| Kaucja przy końcu najmu | Zwrot i zatrzymanie wpisuje się przy końcu **ostatniego** trwającego najmu w umowie (kaucja należy do umowy, Z25) |
| Zatrzymanie kaucji | Na zaległy czynsz: wpłata `czynsz`, metoda `kaucja` (zmniejsza zaległość). Na szkody: `przychod_inny`. Obie są przychodem w dniu zatrzymania (Z26) |
| Stawka na ten sam dzień | Zmiana stawki z datą, na którą stawka już jest, zastępuje ją (podgląd to pokazuje) |
| Zaokrąglenie stawki | Przy zmianie o % albo o kwotę domyślnie do pełnych złotych (8.6), np. 315 zł + 5% = 331 zł |
| Dane startowe | Klient w `najmy.csv` po nazwie albo NIP, więc nazwy klientów muszą być jednoznaczne. Okres rozliczeniowy z importu = 1 miesiąc (szablon nie ma tej kolumny, Z6). Wpłaty gotówkowe od `data_start` do dziś; ta sama wpłata (data, klient, kwota) nie wczyta się drugi raz |

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
| Funkcja `zapisz_pakiet` w bazie (migracja 001) | nowy najem, koniec najmu z kaucją i dane startowe zapisują kilka tabel – supabase-js nie ma transakcji, a 7.5 wymaga „wszystko albo nic” |
| Własny parser CSV (`js/csv.js`) zamiast PapaParse | ~60 linii, bez zależności, testowany w Node; obsługuje cudzysłowy, BOM i Windows-1250 |
| Formularze najmu na osobnym ekranie `#/najmy/…` | najem dotyczy klienta i jednostki naraz; „‹ wstecz” prowadzi do ekranu, z którego przyszedłeś |
| Podgląd zmiany stawki i ostatniej należności przyciskiem „Pokaż podgląd” | przeliczanie przy każdej zmianie pola tekstowego gubiłoby fokus przy przechodzeniu tabulatorem |
| Ramki pól `--line-strong` (#7A8494 / #6B7584) | `--line` ma 1,3:1, a WCAG 1.4.11 wymaga 3:1 dla granic pól |
