// Odczyt i zapis danych w Supabase. Jedyny moduł, który rozmawia z bazą.
// Kopia w IndexedDB (tryb offline) – krok 1d.

import { CONFIG, TABELE } from './config.js';

const SKRYPT_SUPABASE = 'js/vendor/supabase-2.119.0.js';
const ROZMIAR_STRONY = 1000;   // domyślny limit wierszy na zapytanie w Supabase (max rows)

let klient = null;

export const skonfigurowano = () => Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey);

/** Ładuje bibliotekę supabase-js tylko wtedy, gdy jest potrzebna (tryb podglądu działa bez niej). */
function zaladujSkrypt(src) {
  return new Promise((ok, blad) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => blad(new Error('Nie udało się wczytać biblioteki Supabase.'));
    document.head.append(s);
  });
}

export async function polacz() {
  if (klient) return klient;
  if (!window.supabase) await zaladujSkrypt(SKRYPT_SUPABASE);
  klient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return klient;
}

/** Zamienia błąd Supabase na komunikat po polsku. */
function komunikat(error, domyslny) {
  const m = error?.message ?? '';
  if (/Invalid login credentials/i.test(m)) return 'Nieprawidłowy e-mail lub hasło.';
  if (/Email not confirmed/i.test(m)) return 'Adres e-mail nie został potwierdzony.';
  if (/rate limit|too many/i.test(m)) return 'Za dużo prób. Spróbuj za kilka minut.';
  if (/Signups not allowed|not found/i.test(m)) return 'Nie ma konta z tym adresem e-mail.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Brak połączenia z serwerem.';
  return domyslny;
}

// ---------------------------------------------------------------------
// Logowanie (11: Supabase Auth – e-mail i hasło albo link logowania)
// ---------------------------------------------------------------------

export async function pobierzSesje() {
  const { data, error } = await (await polacz()).auth.getSession();
  if (error) throw new Error(komunikat(error, 'Nie udało się odczytać sesji.'));
  return data.session;
}

/**
 * Wywołuje cb(sesja) przy każdej zmianie stanu logowania.
 * setTimeout: Supabase odradza wywoływanie innych metod klienta wewnątrz
 * onAuthStateChange (może dojść do zakleszczenia), a cb pobiera dane.
 */
export async function nasluchujSesji(cb) {
  (await polacz()).auth.onAuthStateChange((_zdarzenie, sesja) => {
    setTimeout(() => cb(sesja), 0);
  });
}

export async function zaloguj(email, haslo) {
  const { error } = await (await polacz()).auth.signInWithPassword({ email, password: haslo });
  if (error) throw new Error(komunikat(error, 'Logowanie nie powiodło się.'));
}

export async function wyslijLink(email) {
  const { error } = await (await polacz()).auth.signInWithOtp({
    email,
    // Jeden użytkownik: link nie zakłada nowego konta.
    options: { shouldCreateUser: false, emailRedirectTo: location.href.split('#')[0] },
  });
  if (error) throw new Error(komunikat(error, 'Nie udało się wysłać linku.'));
}

export async function wyloguj() {
  await (await polacz()).auth.signOut();
}

// ---------------------------------------------------------------------
// Odczyt danych
// ---------------------------------------------------------------------

/** Pobiera całą tabelę stronami po 1000 wierszy (inaczej Supabase obetnie wynik). */
async function pobierzTabele(sb, tabela) {
  const kolumnaSortu = tabela === 'settings' ? 'user_id' : 'id';
  const wiersze = [];
  for (let od = 0; ; od += ROZMIAR_STRONY) {
    const { data, error } = await sb.from(tabela).select('*')
      .order(kolumnaSortu).range(od, od + ROZMIAR_STRONY - 1);
    if (error) throw new Error(`Nie udało się pobrać danych (${tabela}): ${error.message}`);
    wiersze.push(...data);
    if (data.length < ROZMIAR_STRONY) return wiersze;
  }
}

/** Pobiera wszystkie tabele naraz. Zwraca obiekt jak pusteDane(). */
export async function pobierzWszystko() {
  const sb = await polacz();
  const wyniki = await Promise.all(TABELE.map((t) => pobierzTabele(sb, t)));
  const dane = Object.fromEntries(TABELE.map((t, i) => [t, wyniki[i]]));
  dane.settings = dane.settings[0] ?? null;
  return dane;
}

/** Tworzy wiersz ustawień z wartościami domyślnymi, jeśli go nie ma. */
export async function zapewnijUstawienia(userId) {
  const sb = await polacz();
  const { error } = await sb.from('settings')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw new Error(`Nie udało się utworzyć ustawień: ${error.message}`);
}

// ---------------------------------------------------------------------
// Zapis. Każda funkcja zwraca zapisane wiersze – app.js dopisuje je do stanu (dane.scalDane),
// bez pobierania wszystkich tabel od nowa.
// ---------------------------------------------------------------------

/** Ograniczenia bazy → komunikat dla użytkownika (nazwy z supabase/schema.sql i migracji). */
const OGRANICZENIA = {
  units_user_id_code_key: 'Jednostka o tym numerze już istnieje.',
  rentals_no_overlap: 'Ta jednostka ma już najem w tym czasie (test 16). Sprawdź daty.',
  payments_dedup: 'Ta wpłata jest już zapisana.',
  payers_user_id_account_key: 'Ten rachunek jest już przypisany innemu klientowi.',
  payers_user_id_name_key_key: 'Ta nazwa płatnika jest już przypisana innemu klientowi.',
  tax_payments_user_id_year_quarter_key: 'Wpłata ryczałtu za ten kwartał jest już zapisana.',
};

/**
 * Błąd zapisu Supabase/PostgreSQL → komunikat po polsku. Czysta funkcja (tests/db.test.js).
 * @param {{code?: string, message?: string, details?: string}} error
 */
export function komunikatZapisu(error) {
  const m = `${error?.message ?? ''} ${error?.details ?? ''}`;
  const ograniczenie = Object.keys(OGRANICZENIA).find((nazwa) => m.includes(nazwa));
  if (ograniczenie) return OGRANICZENIA[ograniczenie];
  switch (error?.code) {
    case '23505': return 'Taki wpis już istnieje.';
    case '23P01': return OGRANICZENIA.rentals_no_overlap;
    case '23503': return /delete|update/i.test(m)
      ? 'Tych danych nie można usunąć – są z nimi powiązane inne wpisy. Użyj archiwizacji.'
      : 'Wskazany wpis nie istnieje. Odśwież dane i spróbuj ponownie.';
    case '23514': return `Baza odrzuciła nieprawidłową wartość (${/"([^"]+)"/.exec(m)?.[1] ?? 'ograniczenie'}).`;
    case '42501': return 'Brak uprawnień do zapisu. Zaloguj się ponownie.';
    case 'PGRST202': return 'W bazie brakuje funkcji zapisz_pakiet. Uruchom w Supabase plik supabase/migracje/001_zapisz_pakiet.sql.';
    case 'PGRST116': return 'Nie znaleziono wpisu – mógł zostać zmieniony na innym urządzeniu. Odśwież dane.';
    default: break;
  }
  if (/JWT|session/i.test(m)) return 'Sesja wygasła. Zaloguj się ponownie.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Brak połączenia z serwerem. Zmiany nie zostały zapisane.';
  return `Nie udało się zapisać: ${error?.message ?? 'nieznany błąd'}`;
}

function sprawdz({ data, error }) {
  if (error) throw new Error(komunikatZapisu(error));
  return data;
}

/** Dodaje wiersz. Zwraca zapisany wiersz z wartościami domyślnymi z bazy (id, user_id, created_at). */
export async function wstaw(tabela, wiersz) {
  return sprawdz(await (await polacz()).from(tabela).insert(wiersz).select().single());
}

/** Zmienia wiersz o danym id. Zwraca zapisany wiersz. */
export async function zmien(tabela, id, zmiany) {
  return sprawdz(await (await polacz()).from(tabela).update(zmiany).eq('id', id).select().single());
}

/** Dodaje albo nadpisuje wiele wierszy (np. stawki: onConflict 'rental_id,valid_from'). */
export async function zapiszWiele(tabela, wiersze, onConflict) {
  if (!wiersze.length) return [];
  return sprawdz(await (await polacz()).from(tabela).upsert(wiersze, { onConflict }).select());
}

/** Zmienia ustawienia (jeden wiersz na użytkownika). */
export async function zapiszUstawienia(userId, zmiany) {
  return sprawdz(await (await polacz()).from('settings')
    .update({ ...zmiany, updated_at: new Date().toISOString() }).eq('user_id', userId).select().single());
}

/**
 * Zapis kilku tabel w jednej transakcji (funkcja zapisz_pakiet z migracji 001):
 * nowy najem, zakończenie najmu z kaucją, dane startowe – wszystko albo nic.
 * Zwraca { units: [...], rentals: [...], … } – zapisane wiersze.
 */
export async function zapiszPakiet(pakiet) {
  return sprawdz(await (await polacz()).rpc('zapisz_pakiet', { p: pakiet }));
}

// ---------------------------------------------------------------------
// Pliki umów (rozdz. 11): prywatny bucket „umowy”, folder {user_id}/, podpisany link na 60 s
// ---------------------------------------------------------------------

const BUCKET = 'umowy';
const WAZNOSC_LINKU_S = 60;

/** Wgrywa PDF umowy jako {userId}/{umowaId}.pdf (nadpisuje poprzedni). Zwraca ścieżkę. */
export async function wgrajUmowe(userId, umowaId, plik) {
  const sciezka = `${userId}/${umowaId}.pdf`;
  const { error } = await (await polacz()).storage.from(BUCKET)
    .upload(sciezka, plik, { upsert: true, contentType: 'application/pdf' });
  if (error) {
    throw new Error(/size|too large|413/i.test(error.message)
      ? 'PDF jest za duży (limit 10 MB).' : `Nie udało się wgrać PDF: ${error.message}`);
  }
  return sciezka;
}

/** Podpisany link do PDF umowy, ważny 60 s. */
export async function linkDoUmowy(sciezka) {
  const { data, error } = await (await polacz()).storage.from(BUCKET).createSignedUrl(sciezka, WAZNOSC_LINKU_S);
  if (error) throw new Error(`Nie udało się otworzyć PDF: ${error.message}`);
  return data.signedUrl;
}

/** Usuwa wiersz o danym id (np. wiersz importu, gdy zapis wpłat się nie udał). */
export async function usun(tabela, id) {
  sprawdz(await (await polacz()).from(tabela).delete().eq('id', id));
}

/** Ta sama zmiana dla wielu wierszy (np. dopasowanie kolejnych wpłat po zapamiętaniu płatnika). */
export async function zmienWiele(tabela, ids, zmiany) {
  if (!ids.length) return [];
  return sprawdz(await (await polacz()).from(tabela).update(zmiany).in('id', ids).select());
}
