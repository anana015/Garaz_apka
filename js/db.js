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
