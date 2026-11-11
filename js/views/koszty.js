// Etap 2 – koszty (specyfikacja, rozdz. 15). Ekran pod zakładką Raporty.
// Adresy: #/koszty (lista za okres), #/koszty/nowy, #/koszty/<id> (poprawa i usunięcie),
//         #/koszty/reguly (reguły „fraza → kategoria” do importu wypływów).
// Wypływy z wyciągów dochodzą przy imporcie (views/import.js); tu – koszty ręczne, poprawki i reguły.

import { TYPY_JEDNOSTEK } from '../config.js';
import { formularz, maBledy, obszar, pole, stanFormularza, wartosciFormularza, wybor, zapisz } from '../formularz.js';
import { KATEGORIE, kosztyZakresu, nazwaKategorii, POMINIETY } from '../koszty.js';
import { zakresOkresu } from '../statystyki.js';
import { filtry, przycisk, pustyStan } from '../ui.js';
import { esc, dzisiaj, formatData, formatZl, kwotaDoPola, parseKwota, porownajKody } from '../utils.js';
import { pobierzEksport, pokazWybranyMiesiac, wyborMiesiaca } from './wspolne.js';

const OKRESY = [
  { id: 'miesiac', tekst: 'Miesiąc' }, { id: 'kwartal', tekst: 'Kwartał' }, { id: 'rok', tekst: 'Rok' },
  { id: '12m', tekst: 'Ostatnie 12 miesięcy' },
];

const opcjeKategorii = (zPominietym = false) => [
  ...Object.entries(KATEGORIE).map(([wartosc, tekst]) => ({ wartosc, tekst })),
  ...(zPominietym ? [{ wartosc: POMINIETY, tekst: nazwaKategorii(POMINIETY) }] : []),
];

const opcjeJednostek = (s) => s.dane.units.filter((j) => !j.archived)
  .sort((a, b) => Object.keys(TYPY_JEDNOSTEK).indexOf(a.type) - Object.keys(TYPY_JEDNOSTEK).indexOf(b.type)
    || porownajKody(a.code, b.code))
  .map((j) => ({ wartosc: j.id, tekst: j.code, grupa: TYPY_JEDNOSTEK[j.type]?.mnoga }));

// ---------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------

function lista(s) {
  const okres = s.ui.filtry.koszty ?? 'miesiac';
  const z = zakresOkresu(okres, s.ui.miesiac, dzisiaj());
  const kategoria = s.ui.kategoriaKosztow ?? '';
  const wszystkie = (s.dane.expenses ?? []).filter((e) => e.spent_on >= z.od && e.spent_on <= z.do);
  const koszty = kosztyZakresu(wszystkie, z.od, z.do);
  const pominiete = wszystkie.filter((e) => e.category === POMINIETY);
  const widoczne = (kategoria === POMINIETY ? pominiete : koszty.filter((e) => !kategoria || e.category === kategoria))
    .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.amount_gr - a.amount_gr);
  const suma = koszty.reduce((x, e) => x + e.amount_gr, 0);
  const wgKategorii = Object.keys(KATEGORIE).map((k) => [k, koszty.filter((e) => e.category === k).reduce((x, e) => x + e.amount_gr, 0)])
    .filter(([, gr]) => gr);
  const chipy = [['', `Wszystkie (${formatZl(suma, { grosze: false })})`],
    ...wgKategorii.map(([k, gr]) => [k, `${KATEGORIE[k]} (${formatZl(gr, { grosze: false })})`]),
    ...(pominiete.length ? [[POMINIETY, `Pominięte (${pominiete.length})`]] : [])];

  const wiersze = widoczne.map((e) => {
    const j = e.unit_id ? s.indeksy.jednostki.get(e.unit_id) : null;
    const opis = [e.counterparty, e.title, e.note].filter(Boolean).join(' · ');
    return `<li><a class="wiersz" href="#/koszty/${encodeURIComponent(e.id)}">
      <div class="glowna"><strong>${esc(nazwaKategorii(e.category))}${j ? ` · <span class="mono">${esc(j.code)}</span>` : ''}</strong>
        <span>${formatData(e.spent_on)}${opis ? ` · ${esc(opis)}` : ''}${e.source === 'import' ? ' · z wyciągu' : ''}</span></div>
      <div class="prawa kwota">${formatZl(e.amount_gr)}</div></a></li>`;
  }).join('');

  return `
    <div class="pasek-akcji">
      ${przycisk({ tekst: 'Dodaj koszt', href: '#/koszty/nowy', ikona: 'plus' })}
      ${przycisk({ tekst: 'Reguły importu', href: '#/koszty/reguly', drugi: true })}
      ${przycisk({ tekst: 'Wczytaj wyciąg', href: '#/import', drugi: true })}
      <button type="button" class="przycisk drugi" data-akcja="eksport-kosztow" data-od="${z.od}" data-do="${z.do}"
        ${koszty.length ? '' : 'disabled'}>Eksport okresu (CSV)</button>
    </div>
    ${filtry(OKRESY, okres, 'Okres')}
    ${okres !== '12m' ? wyborMiesiaca(s) : ''}
    ${z.tytul ? `<p class="podpowiedz">${esc(z.tytul)}: ${formatData(z.od)} – ${formatData(z.do)}</p>` : ''}
    <div class="filtry" role="group" aria-label="Kategoria">${chipy.map(([id, tekst]) => `<button type="button"
      data-akcja="kategoria-kosztow" data-wartosc="${id}" aria-pressed="${id === kategoria}">${esc(tekst)}</button>`).join('')}</div>
    <section class="karta">${wiersze ? `<ul class="lista">${wiersze}</ul>`
    : pustyStan(kategoria === POMINIETY ? 'Brak pominiętych wypływów.' : 'Brak kosztów w tym okresie.')}</section>
    <p class="podpowiedz">Koszty z wyciągów dochodzą przy imporcie (wypływy). Przy ryczałcie koszty nie zmniejszają podatku –
      zysk w Raportach to wskaźnik do zarządzania.</p>`;
}

// ---------------------------------------------------------------------
// Formularz kosztu
// ---------------------------------------------------------------------

function formularzKosztu(s, e) {
  const f = stanFormularza(s, `koszty/${s.ui.parametr}`, () => (e
    ? { spent_on: e.spent_on, amount_gr: kwotaDoPola(e.amount_gr), category: e.category, unit_id: e.unit_id ?? '', note: e.note ?? '' }
    : { spent_on: dzisiaj(), category: '', unit_id: '' }));
  const usun = !e ? '' : !f.potwierdzUsuniecie
    ? '<p><button type="button" class="link-btn" data-akcja="usun-koszt">Usuń ten koszt</button></p>'
    : `<section class="karta" role="alert" aria-labelledby="usun-koszt-tytul">
      <h2 id="usun-koszt-tytul">Usunąć koszt?</h2>
      <p><span class="kwota">${formatZl(e.amount_gr)}</span> z ${formatData(e.spent_on)}.${e.source === 'import'
    ? ' Wypływ z wyciągu wróci przy ponownym imporcie tego pliku – zamiast usuwać, możesz oznaczyć go jako „Pominięty”.' : ''}</p>
      <div class="pasek-akcji">
        <button type="button" class="przycisk" data-akcja="usun-koszt-tak"${f.trwa ? ' disabled' : ''}>Usuń</button>
        <button type="button" class="przycisk drugi" data-akcja="usun-koszt-nie">Nie usuwaj</button>
      </div></section>`;
  const zWyciagu = e?.source === 'import' ? `<section class="karta"><dl class="opis-pol">
      <dt>Z wyciągu</dt><dd>${esc(s.indeksy.konta.get(e.bank_account_id)?.name ?? '—')}</dd>
      ${e.counterparty ? `<dt>Odbiorca</dt><dd>${esc(e.counterparty)}</dd>` : ''}
      ${e.title ? `<dt>Tytuł</dt><dd>${esc(e.title)}</dd>` : ''}</dl></section>` : '';
  return `${zWyciagu}${formularz(f, {
    nazwa: 'koszt', przycisk: e ? 'Zapisz zmiany' : 'Dodaj koszt', anuluj: '#/koszty',
    tresc: `
      <div class="pola-w-rzedzie">
        ${pole(f, { nazwa: 'spent_on', etykieta: 'Data', typ: 'date', wymagane: true })}
        ${pole(f, { nazwa: 'amount_gr', etykieta: 'Kwota (zł)', typ: 'kwota', wymagane: true })}
      </div>
      <div class="pola-w-rzedzie">
        ${wybor(f, { nazwa: 'category', etykieta: 'Kategoria', wymagane: true, pusta: 'Wybierz…', opcje: opcjeKategorii(Boolean(e)) })}
        ${wybor(f, { nazwa: 'unit_id', etykieta: 'Jednostka (opcjonalnie)', pusta: '— koszt wspólny —', opcje: opcjeJednostek(s),
    podpowiedz: 'Koszt wspólny rozkłada się na jednostki proporcjonalnie do przychodu.' })}
      </div>
      ${obszar(f, { nazwa: 'note', etykieta: 'Opis', wiersze: 2, maks: 500 })}`,
  })}${usun}`;
}

function walidujKoszt(w, s) {
  const bledy = {};
  const spent_on = /^\d{4}-\d{2}-\d{2}$/.test(w.spent_on ?? '') ? w.spent_on : null;
  if (!spent_on) bledy.spent_on = 'Podaj datę.';
  const amount_gr = parseKwota(w.amount_gr);
  if (amount_gr == null || amount_gr <= 0) bledy.amount_gr = 'Podaj kwotę większą od zera.';
  const category = KATEGORIE[w.category] || w.category === POMINIETY ? w.category : null;
  if (!category) bledy.category = 'Wybierz kategorię.';
  const unit_id = w.unit_id && s.indeksy.jednostki.has(w.unit_id) ? w.unit_id : null;
  const note = String(w.note ?? '').trim() || null;
  return { bledy, wiersz: { spent_on, amount_gr, category, unit_id, note } };
}

// ---------------------------------------------------------------------
// Reguły „fraza → kategoria”
// ---------------------------------------------------------------------

function ekranRegul(s) {
  const f = stanFormularza(s, 'koszty/reguly', () => ({ phrase: '', category: '', unit_id: '' }));
  const reguly = [...(s.dane.cost_rules ?? [])].sort((a, b) => a.phrase.localeCompare(b.phrase, 'pl'));
  const lista = reguly.length ? `<ul class="lista">${reguly.map((r) => `<li><div class="wiersz">
      <div class="glowna"><strong class="mono">${esc(r.phrase)}</strong>
        <span>→ ${esc(nazwaKategorii(r.category))}${r.unit_id ? ` · ${esc(s.indeksy.jednostki.get(r.unit_id)?.code ?? '?')}` : ''}</span></div>
      <div class="prawa"><button type="button" class="link-btn" data-akcja="usun-regule" data-id="${esc(r.id)}"
        aria-label="Usuń regułę ${esc(r.phrase)}">Usuń</button></div></div></li>`).join('')}</ul>`
    : '<p class="wyciszony">Brak reguł. Dodaj je tutaj albo zaznacz „Zapamiętaj” przy wypływie w imporcie.</p>';
  return `<section class="karta"><h2>Reguły</h2>${lista}
      <p class="podpowiedz">Fraza jest szukana w nazwie odbiorcy i tytule przelewu (bez ogonków, wielkość liter bez znaczenia).
        Przy kilku pasujących wygrywa najdłuższa.</p></section>
    ${formularz(f, {
    nazwa: 'regula', przycisk: 'Dodaj regułę', anuluj: '#/koszty',
    tresc: `
      ${pole(f, { nazwa: 'phrase', etykieta: 'Fraza', wymagane: true, atrybuty: 'maxlength="80" autocomplete="off"',
    podpowiedz: 'Np. ENERGA, TAURON, PZU, OPLATA ZA PROWADZENIE.' })}
      <div class="pola-w-rzedzie">
        ${wybor(f, { nazwa: 'category', etykieta: 'Kategoria', wymagane: true, pusta: 'Wybierz…', opcje: opcjeKategorii(true) })}
        ${wybor(f, { nazwa: 'unit_id', etykieta: 'Jednostka (opcjonalnie)', pusta: '— koszt wspólny —', opcje: opcjeJednostek(s) })}
      </div>`,
  })}`;
}

// ---------------------------------------------------------------------

export default {
  zakladka: 'raporty',

  tytul(s) {
    const { parametr } = s.ui;
    if (!parametr) return 'Koszty';
    if (parametr === 'nowy') return 'Nowy koszt';
    if (parametr === 'reguly') return 'Reguły importu kosztów';
    return 'Koszt';
  },

  wstecz: (s) => (s.ui.parametr ? { href: '#/koszty', tekst: 'Koszty' } : { href: '#/raporty', tekst: 'Raporty' }),

  render(s) {
    const { parametr } = s.ui;
    if (!parametr) return lista(s);
    if (parametr === 'nowy') return formularzKosztu(s, null);
    if (parametr === 'reguly') return ekranRegul(s);
    const e = s.dane.expenses.find((x) => x.id === parametr);
    return e ? formularzKosztu(s, e) : pustyStan('Nie znaleziono kosztu.', [{ tekst: 'Koszty', href: '#/koszty' }]);
  },

  poRenderze(root, s) {
    if (!s.ui.parametr && (s.ui.filtry.koszty ?? 'miesiac') !== '12m') pokazWybranyMiesiac(root);
  },

  akcje: {
    /** Koszty z wybranego okresu do CSV (Excel, księgowa) – bez pominiętych wypływów. */
    'eksport-kosztow'(el, ctx) {
      pobierzEksport(ctx.state, 'koszty', { od: el.dataset.od, do: el.dataset.do });
    },
    'kategoria-kosztow'(el, ctx) {
      ctx.state.ui.kategoriaKosztow = el.dataset.wartosc;
      ctx.render();
    },
    'usun-koszt'(_el, ctx) {
      if (!ctx.state.ui.form) return;
      ctx.state.ui.form.potwierdzUsuniecie = true;
      ctx.render();
    },
    'usun-koszt-nie'(_el, ctx) {
      if (ctx.state.ui.form) ctx.state.ui.form.potwierdzUsuniecie = false;
      ctx.render();
    },
    async 'usun-koszt-tak'(_el, ctx) {
      const s = ctx.state;
      const e = s.dane.expenses.find((x) => x.id === s.ui.parametr);
      if (!e) return;
      await zapisz(ctx, async () => {
        await ctx.db.usun('expenses', e.id);
        s.dane = { ...s.dane, expenses: s.dane.expenses.filter((x) => x.id !== e.id) };
        ctx.scal({});
        ctx.toast(`Usunięto koszt ${formatZl(e.amount_gr)}`);
        ctx.nawiguj('koszty');
      });
    },
    async 'usun-regule'(el, ctx) {
      const s = ctx.state;
      const id = el.dataset.id;
      if (s.podglad || s.offline || s.zKopii) {
        ctx.toast('Usuwanie wymaga połączenia z bazą.');
        return;
      }
      try {
        await ctx.db.usun('cost_rules', id);
        s.dane = { ...s.dane, cost_rules: s.dane.cost_rules.filter((r) => r.id !== id) };
        ctx.scal({});
        ctx.toast('Usunięto regułę');
        ctx.render();
      } catch (e) {
        ctx.toast(e.message);
      }
    },
  },

  formularze: {
    async koszt(form, ctx) {
      const s = ctx.state;
      const e = s.ui.parametr === 'nowy' ? null : s.dane.expenses.find((x) => x.id === s.ui.parametr);
      const w = wartosciFormularza(form);
      const { bledy, wiersz } = walidujKoszt(w, s);
      if (maBledy(ctx, w, bledy)) return;
      await zapisz(ctx, async () => {
        const zapisany = e ? await ctx.db.zmien('expenses', e.id, wiersz) : await ctx.db.wstaw('expenses', { ...wiersz, source: 'reczne' });
        ctx.scal({ expenses: [zapisany] });
        ctx.toast(e ? 'Zapisano koszt' : `Dodano koszt ${formatZl(zapisany.amount_gr)}`);
        ctx.nawiguj('koszty');
      });
    },
    async regula(form, ctx) {
      const s = ctx.state;
      const w = wartosciFormularza(form);
      const bledy = {};
      const phrase = String(w.phrase ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (phrase.length < 2) bledy.phrase = 'Fraza: co najmniej 2 znaki.';
      else if ((s.dane.cost_rules ?? []).some((r) => r.phrase === phrase)) bledy.phrase = 'Taka reguła już jest.';
      if (!KATEGORIE[w.category] && w.category !== POMINIETY) bledy.category = 'Wybierz kategorię.';
      if (maBledy(ctx, w, bledy)) return;
      await zapisz(ctx, async () => {
        const r = await ctx.db.wstaw('cost_rules', { phrase, category: w.category, unit_id: w.unit_id || null });
        ctx.scal({ cost_rules: [r] });
        s.ui.form = null;
        ctx.toast(`Dodano regułę ${phrase}`);
        ctx.render();
      });
    },
  },
};
