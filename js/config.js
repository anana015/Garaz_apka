// Konfiguracja aplikacji. Uzupełnij po utworzeniu projektu Supabase (README.md, krok 2).
// Klucz publiczny (anon albo publishable) może być w kodzie strony – dane chroni RLS.
// Klucza service_role NIGDY tu nie wpisuj.

export const CONFIG = Object.freeze({
  supabaseUrl: 'https://sdxgdeyvlfgnnzwgkbce.supabase.co',
  supabaseKey: 'sb_publishable_aFlZhbycefQPMj6imB3jFQ_KSLQmZ28',   // klucz publiczny (publishable)
});

export const WERSJA = '0.18.2';

/** Tabele z rozdziału 4 – kolejność nie ma znaczenia, służy do pobierania i kopii zapasowej. */
export const TABELE = Object.freeze([
  'units', 'clients', 'contracts', 'rentals', 'rental_rates', 'charge_adjustments',
  'bank_accounts', 'imports', 'payments', 'payers', 'deposits', 'client_notes',
  'tax_payments', 'settings',
  'expenses', 'cost_rules',   // etap 2 (migracja 010)
  'gates', 'gate_access',     // bramy GSM (migracja 012)
]);
/** Tabele, które mogą jeszcze nie istnieć (migracja nieuruchomiona) – brak = pusta lista zamiast błędu. */
export const TABELE_OPCJONALNE = Object.freeze(['expenses', 'cost_rules', 'gates', 'gate_access']);

/** Etykiety terminowości (5.5). Sprawdzane od góry. */
export const PROGI_TERMINOWOSCI = Object.freeze({
  minNaleznosci: 3,            // poniżej: „Za mało danych”
  wzorowyMinNaleznosci: 6,     // „Wzorowy”: 100% i co najmniej 6 należności
  terminowy: 0.9,              // co najmniej 90%
  zdarzaSie: 0.7,              // 70–89%
});

/**
 * Typy jednostek (Z1 + decyzja 3 z 10.11.2026: box rozdzielony na duży i mały).
 * Kolejność = kolejność grup na ekranie Jednostki. Klucze muszą zgadzać się z units_type_check w bazie.
 */
export const TYPY_JEDNOSTEK = Object.freeze({
  garaz: { nazwa: 'Garaż', mnoga: 'Garaże' },
  kontener: { nazwa: 'Kontener', mnoga: 'Kontenery' },
  box_duzy: { nazwa: 'Box XL (duży)', mnoga: 'Boxy XL (duże)' },
  box_maly: { nazwa: 'Box XS (mały)', mnoga: 'Boxy XS (małe)' },
});

/** Typy jednostek wynajmowane bez kaucji (prośba 11.11: boxy nie mają kaucji). */
export const TYPY_BEZ_KAUCJI = Object.freeze(['box_duzy', 'box_maly']);
export const bezKaucji = (typ) => TYPY_BEZ_KAUCJI.includes(typ);

/** Wartości domyślne ustawień – takie same jak w supabase/schema.sql (tabela settings). */
export const DOMYSLNE_USTAWIENIA = Object.freeze({
  tolerance_days: 3,
  punctuality_months: 12,
  expiring_days: 30,
  default_last_period: 'proporcjonalnie',
  default_billing_day: 20,   // decyzja 11.11: wszyscy płacą 20., niezależnie od daty umowy
  tax_period: 'kwartal',
  tax_rate_low_bp: 850,
  tax_rate_high_bp: 1250,
  tax_threshold_gr: 10_000_000,
  vat_limit_gr: 24_000_000,
  tax_account: null,
  data_start: '2026-01-01',
  last_backup_at: null,
  promotions: null,          // lista promocji (js/promocje.js); null = domyślna, migracja 007
  contract_templates: null,  // wzory umów (js/umowy.js); migracja 011
});

export const TOAST_MS = 2600;           // 12.2
export const DNI_BEZ_IMPORTU = 14;      // 8.1, pasek „Brak importu z konta … od 14 dni”
export const DNI_PRZYPOMNIENIA_KOPII = 30;
