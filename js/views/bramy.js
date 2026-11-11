// Bramy GSM (prośba 11.11.2026), wariant A: SMS z telefonu jednym dotknięciem.
// Adresy: #/bramy – lista do zrobienia (do usunięcia, do przypisania, z dostępem),
//         #/bramy/<id klienta>?brama=<numer> – przypisanie / usunięcie numeru klienta w jednej bramie.
// Dane sterowników (numer SIM, hasło, szablony poleceń) wpisuje się w Supabase – supabase/jednorazowe/bramy_wpisz.sql.

import {
  bramyDoZrobienia, czyIos, DNI_PO_KONCU, linkSms, polecenieDodania, polecenieUsuniecia, stanBramKlienta,
  telefonMiedzynarodowy, wiadomoscDlaKlienta, wolnaPozycja,
} from '../bramy.js';
import { formularz, maBledy, pole, stanFormularza, wartosciFormularza, zapisz } from '../formularz.js';
import { pustyStan } from '../ui.js';
import { dzisiaj, esc, formatData, noweId, odmiana } from '../utils.js';

const bezBram = () => pustyStan('Nie ma jeszcze danych bram. Uruchom w Supabase migrację 012_bramy.sql, a potem '
  + 'supabase/jednorazowe/bramy_wpisz.sql z numerami kart SIM i hasłami sterowników.');

/** „hasło ukryte”: w podglądzie polecenia zamiast hasła kropki (hasło jest tylko w wysyłanym SMS-ie). */
const ukryjHaslo = (tekst, brama) => (brama.password ? tekst.split(brama.password).join('••••') : tekst);

/** Duży przycisk-link do Wiadomości. Zwykły link (bez data-akcja), więc iPhone otwiera go bez blokad. */
const przyciskSms = (numer, tresc, napis, drugi = false) =>
  `<a class="przycisk${drugi ? ' drugi' : ''} pelny-wiersz" href="${esc(linkSms(numer, tresc, czyIos()))}">${esc(napis)}</a>`;

// ---------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------

function wiersz(x, prawa) {
  return `<li><a class="wiersz" href="#/bramy/${encodeURIComponent(x.klient.id)}?brama=${x.numer}">
    <div class="glowna"><strong>${esc(x.klient.name)}</strong>
      <span>Brama ${x.numer} · ${x.najmy.map((n) => `<span class="chip">${esc(n.kod)}</span>`).join('') || 'brak najmów'}</span></div>
    <div class="prawa">${prawa}</div></a></li>`;
}

function lista(s) {
  if (!s.dane.gates?.length) return bezBram();
  const dzis = dzisiaj();
  const kod = (n) => ({ ...n, kod: s.indeksy.jednostki.get(n.unit_id)?.code ?? '?' });
  const { doPrzypisania, doUsuniecia } = bramyDoZrobienia(s, dzis);
  const z = (lista) => lista.map((x) => ({ ...x, najmy: x.najmy.map(kod) }));
  const aktywne = (s.dane.gate_access ?? []).filter((d) => !d.removed_on);
  const istniejacy = doPrzypisania.filter((x) => x.najmy.some((n) => n.start_on <= dzis));
  const bramy = [...s.dane.gates].sort((a, b) => a.numer - b.numer);
  return `
    <div class="siatka">
      <section class="karta" aria-labelledby="b-usun"><h2 id="b-usun">Do usunięcia (${doUsuniecia.length})</h2>
        ${doUsuniecia.length ? `<ul class="lista">${z(doUsuniecia).map((x) => wiersz(x,
    `<span class="status zalega">od ${formatData(x.usunOd)}</span>`)).join('')}</ul>`
    : '<p class="wyciszony">Nikogo nie trzeba usuwać.</p>'}
        <p class="podpowiedz">Numer usuwamy ${DNI_PO_KONCU} dni po końcu najmu (koniec okresu wypowiedzenia), gdy klient
          nie ma już innej jednostki za tą bramą.</p></section>
      <section class="karta" aria-labelledby="b-dodaj"><h2 id="b-dodaj">Do przypisania (${doPrzypisania.length})</h2>
        ${doPrzypisania.length ? `<ul class="lista">${z(doPrzypisania).map((x) => wiersz(x,
    `<span class="status czesciowo">${x.najmy.every((n) => n.start_on > dzis) ? `od ${formatData(x.najmy[0].start_on)}` : 'brak dostępu'}</span>`)).join('')}</ul>`
    : '<p class="wyciszony">Wszyscy najemcy mają dostęp.</p>'}
        ${istniejacy.length ? `<div class="baner"><span>Klienci wpisani do sterownika przed aplikacją też są na tej liście.
          Oznacz ich jednym przyciskiem – aplikacja zapamięta, że mają dostęp (bez numeru pozycji). Nowi klienci dostają pozycje
          od ${bramy[0]?.first_slot ?? 200}.</span></div>
          ${s.ui.form?.potwierdzWczesniej
    ? `<p class="potwierdzenie">Oznaczyć ${odmiana(istniejacy.length, ['dostęp', 'dostępy', 'dostępów'])} jako wpisane wcześniej?
              <button type="button" class="przycisk" data-akcja="wczesniej-tak">Oznacz</button>
              <button type="button" class="link-btn" data-akcja="wczesniej-nie">Anuluj</button></p>`
    : `<p><button type="button" class="przycisk drugi" data-akcja="wczesniej">Obecni najemcy są już w sterowniku (${istniejacy.length})</button></p>`}` : ''}
      </section>
      <section class="karta" aria-labelledby="b-sterowniki"><h2 id="b-sterowniki">Sterowniki</h2>
        <dl class="opis-pol">${bramy.map((b) => `<dt>${esc(b.nazwa || `Brama ${b.numer}`)}</dt><dd>
          <span class="mono">${esc(b.sim_phone)}</span><br>${odmiana(aktywne.filter((d) => d.gate_id === b.id).length, ['numer', 'numery', 'numerów'])}
          · następna pozycja ${wolnaPozycja(b, aktywne) ?? '<span class="status zalega">brak wolnych</span>'}${
  b.remove_template ? '' : '<br><span class="maly status czesciowo">brak polecenia usuwania</span>'}</dd>`).join('')}</dl>
        <p class="podpowiedz">Numery SIM, hasła i polecenia zmienia się w Supabase (tabela gates). Rzędy R1–R4 → brama 1, boxy → brama 2.</p>
      </section>
      <section class="karta szeroka" aria-labelledby="b-dostep"><h2 id="b-dostep">Z dostępem (${aktywne.length})</h2>
        ${aktywne.length ? `<details class="historia-stawek"><summary>Pokaż listę</summary>
          <div class="tabela-przewijana"><table class="tabela"><thead><tr><th scope="col">Klient</th><th scope="col">Brama</th>
            <th scope="col">Telefon</th><th scope="col" class="kwota">Pozycja</th><th scope="col">Od</th></tr></thead>
          <tbody>${aktywne.map((d) => ({ d, k: s.indeksy.klienci.get(d.client_id), b: bramy.find((x) => x.id === d.gate_id) }))
    .sort((a, b) => (a.b?.numer ?? 0) - (b.b?.numer ?? 0) || (a.d.slot ?? -1) - (b.d.slot ?? -1))
    .map(({ d, k, b }) => `<tr><td><a href="#/bramy/${encodeURIComponent(d.client_id)}?brama=${b?.numer ?? ''}">${esc(k?.name ?? '?')}</a></td>
            <td>${b?.numer ?? '?'}</td><td class="mono">${esc(d.phone)}</td><td class="kwota">${d.slot ?? '—'}</td>
            <td>${formatData(d.added_on)}</td></tr>`).join('')}</tbody></table></div></details>`
    : '<p class="wyciszony">Nikt jeszcze nie ma zapisanego dostępu.</p>'}</section>
    </div>`;
}

// ---------------------------------------------------------------------
// Klient i jedna brama
// ---------------------------------------------------------------------

function ekranKlienta(s) {
  if (!s.dane.gates?.length) return bezBram();
  const klient = s.indeksy.klienci.get(s.ui.parametr);
  if (!klient) return pustyStan('Nie znaleziono klienta.', [{ tekst: 'Bramy', href: '#/bramy' }]);
  const dzis = dzisiaj();
  const numer = Number(s.ui.zapytanie.brama) || 1;
  const stan = stanBramKlienta(s, klient.id, dzis).find((b) => b.numer === numer);
  const brama = s.dane.gates.find((b) => b.numer === numer);
  if (!brama) return pustyStan(`W bazie nie ma bramy ${numer}. Dopisz ją w supabase/jednorazowe/bramy_wpisz.sql.`);
  const dostep = stan?.dostep ?? null;
  const f = stanFormularza(s, `bramy/${klient.id}/${numer}`, () => ({
    telefon: telefonMiedzynarodowy(klient.phone) ?? klient.phone ?? '',
    pozycja: String(wolnaPozycja(brama, s.dane.gate_access ?? []) ?? ''),
  }));
  const kody = (stan?.najmy ?? []).map((n) => s.indeksy.jednostki.get(n.unit_id)?.code ?? '?');
  const naglowek = `<section class="karta"><dl class="opis-pol">
      <dt>Klient</dt><dd><a href="#/klienci/${encodeURIComponent(klient.id)}"><strong>${esc(klient.name)}</strong></a></dd>
      <dt>Brama</dt><dd>${esc(brama.nazwa || `Brama ${numer}`)} · SIM <span class="mono">${esc(brama.sim_phone)}</span></dd>
      <dt>Jednostki za bramą</dt><dd>${kody.length ? kody.map((c) => `<span class="chip">${esc(c)}</span>`).join('') : 'brak najmów'}</dd>
      ${dostep ? `<dt>Dostęp</dt><dd><span class="mono">${esc(dostep.phone)}</span> · pozycja ${dostep.slot ?? 'nieznana (wpisany wcześniej)'} · od ${formatData(dostep.added_on)}</dd>` : ''}
      ${stan?.usunOd ? `<dt>Usunąć od</dt><dd>${stan.usunOd <= dzis ? `<span class="status zalega">${formatData(stan.usunOd)}</span>` : formatData(stan.usunOd)}</dd>` : ''}
    </dl></section>`;

  // Po zapisie: kroki z linkami do Wiadomości.
  if (f.wynik) return `${naglowek}${f.wynik}`;

  if (!dostep) {
    const w = { telefon: telefonMiedzynarodowy(f.wartosci.telefon) ?? f.wartosci.telefon, pozycja: f.wartosci.pozycja };
    return `${naglowek}${formularz(f, {
      nazwa: 'przypisz',
      przycisk: `Przypisz do bramy ${numer}`,
      drugiPrzycisk: { tekst: 'Był już wpisany wcześniej', wartosc: 'wczesniej' },
      anuluj: `#/klienci/${encodeURIComponent(klient.id)}`,
      tresc: `<div class="pola-w-rzedzie">
          ${pole(f, { nazwa: 'telefon', etykieta: 'Telefon klienta', typ: 'tel', wymagane: true, odswiez: true,
    podpowiedz: 'Z karty klienta; można wpisać inny (np. męża).' })}
          ${pole(f, { nazwa: 'pozycja', etykieta: 'Pozycja w sterowniku', wymagane: true, odswiez: true, atrybuty: 'inputmode="numeric"',
    podpowiedz: `Pierwsza wolna od ${brama.first_slot}.` })}
        </div>
        <p class="maly">Polecenie do bramy: <span class="mono">${esc(ukryjHaslo(polecenieDodania(brama, w), brama))}</span></p>
        <p class="maly">SMS do klienta: ${esc(wiadomoscDlaKlienta(brama, w))}</p>
        <p class="podpowiedz">Po zapisie pojawią się dwa przyciski: SMS do bramy i SMS do klienta – w Wiadomościach dotknij „Wyślij”.
          „Był już wpisany wcześniej” zapisuje dostęp bez SMS-ów (pozycję zostaw pustą, jeśli jej nie znasz).</p>`,
    })}`;
  }

  // Ma dostęp: ponowne SMS-y i usunięcie.
  const poleceniePonownie = polecenieDodania(brama, { telefon: dostep.phone, pozycja: dostep.slot });
  const ponownie = dostep.slot != null ? `<details class="historia-stawek"><summary>Wyślij SMS-y jeszcze raz</summary>
      <div class="pasek-akcji">${przyciskSms(brama.sim_phone, poleceniePonownie, 'Polecenie do bramy', true)}
        ${przyciskSms(dostep.phone, wiadomoscDlaKlienta(brama, { telefon: dostep.phone }), 'SMS do klienta', true)}</div></details>` : '';
  const doUsuniecia = stan?.usunOd && stan.usunOd <= dzis;
  return `${naglowek}${formularz(f, {
    nazwa: 'usun-z-bramy',
    przycisk: 'Usuń z bramy',
    anuluj: `#/klienci/${encodeURIComponent(klient.id)}`,
    uwaga: '',
    tresc: `${!doUsuniecia ? `<p class="baner ostrzezenie"><span>${stan?.usunOd ? `Termin usunięcia to ${formatData(stan.usunOd)}.`
      : 'Klient ma trwający najem za tą bramą.'} Usuń wcześniej tylko wtedy, gdy na pewno trzeba.</span></p>` : ''}
      ${!brama.remove_template ? `<p class="baner blad"><span>W bazie nie ma polecenia usuwania dla tej bramy. Wpisz je w Supabase
        (gates.remove_template, z instrukcji sterownika). Możesz zapisać usunięcie teraz, a SMS wysłać ręcznie.</span></p>` : ''}
      ${dostep.slot == null ? pole(f, { nazwa: 'pozycja', etykieta: 'Pozycja w sterowniku (jeśli znasz)', atrybuty: 'inputmode="numeric"',
    podpowiedz: 'Klient był wpisany przed aplikacją – polecenie usuwania może wymagać pozycji.' }) : ''}
      <p class="podpowiedz">Zapisuje usunięcie i pokazuje przycisk SMS-a z poleceniem usunięcia. Pozycja ${dostep.slot ?? ''} wraca do puli.</p>
      ${ponownie}`,
  })}`;
}

// ---------------------------------------------------------------------
// Zapis
// ---------------------------------------------------------------------

function kontekst(ctx) {
  const s = ctx.state;
  const klient = s.indeksy.klienci.get(s.ui.parametr);
  const numer = Number(s.ui.zapytanie.brama) || 1;
  const brama = s.dane.gates?.find((b) => b.numer === numer);
  return { s, klient, numer, brama };
}

async function przypisz(form, ctx, ev) {
  const { s, klient, brama } = kontekst(ctx);
  if (!klient || !brama) return;
  const w = wartosciFormularza(form);
  const wczesniej = ev?.submitter?.value === 'wczesniej';
  const telefon = telefonMiedzynarodowy(w.telefon);
  const pozycja = String(w.pozycja ?? '').trim();
  const bledy = {};
  if (!telefon) bledy.telefon = 'Podaj polski numer komórkowy: 9 cyfr albo +48 i 9 cyfr.';
  if (!(wczesniej && !pozycja)) {
    if (!/^\d{1,5}$/.test(pozycja)) bledy.pozycja = 'Podaj numer pozycji (same cyfry).';
    else if ((s.dane.gate_access ?? []).some((d) => d.gate_id === brama.id && !d.removed_on && d.slot === Number(pozycja))) {
      bledy.pozycja = `Pozycja ${pozycja} jest już zajęta w tej bramie.`;
    } else if (brama.max_slot != null && Number(pozycja) > brama.max_slot) bledy.pozycja = `Sterownik ma pozycje do ${brama.max_slot}.`;
  }
  if (maBledy(ctx, w, bledy)) return;
  await zapisz(ctx, async () => {
    const zapisany = await ctx.db.wstaw('gate_access', {
      gate_id: brama.id, client_id: klient.id, phone: telefon, slot: pozycja ? Number(pozycja) : null, added_on: dzisiaj(),
      ...(wczesniej ? { note: 'wpisany wcześniej' } : {}),
    });
    ctx.scal({ gate_access: [zapisany] });
    const f = ctx.state.ui.form;
    f.trwa = false;
    if (wczesniej) {
      ctx.toast(`Zapisano: ${klient.name} ma dostęp do bramy ${brama.numer}`);
      ctx.nawiguj('bramy');
      return;
    }
    const dane = { telefon, pozycja: zapisany.slot };
    f.wynik = `<section class="karta">
        <h2>Wyślij dwa SMS-y</h2>
        <p>Dostęp zapisany (pozycja ${zapisany.slot}). Dotknij przycisku, w Wiadomościach dotknij „Wyślij” i wróć do aplikacji.</p>
        <div class="kroki-sms">
          <p><strong>1.</strong> Polecenie do sterownika bramy ${brama.numer}</p>
          ${przyciskSms(brama.sim_phone, polecenieDodania(brama, dane), `SMS do bramy ${brama.numer}`)}
          <p><strong>2.</strong> Informacja dla klienta</p>
          ${przyciskSms(telefon, wiadomoscDlaKlienta(brama, dane), 'SMS do klienta', true)}
        </div>
        <p class="pasek-akcji"><a class="link-btn" href="#/klienci/${encodeURIComponent(klient.id)}">Gotowe – wróć do klienta</a>
          <a class="link-btn" href="#/bramy">Lista bram</a></p>
      </section>`;
    ctx.toast(`Przypisano: ${klient.name} → brama ${brama.numer}, pozycja ${zapisany.slot}`);
    ctx.render();
  });
}

async function usun(form, ctx) {
  const { s, klient, brama } = kontekst(ctx);
  if (!klient || !brama) return;
  const dostep = (s.dane.gate_access ?? []).find((d) => d.client_id === klient.id && d.gate_id === brama.id && !d.removed_on);
  if (!dostep) return;
  const w = wartosciFormularza(form);
  const pozycja = dostep.slot ?? (String(w.pozycja ?? '').trim() ? Number(w.pozycja) : null);
  if (w.pozycja && !/^\d{1,5}$/.test(String(w.pozycja).trim()) && maBledy(ctx, w, { pozycja: 'Same cyfry.' })) return;
  await zapisz(ctx, async () => {
    const dzis = dzisiaj();
    const zapisany = await ctx.db.zmien('gate_access', dostep.id, {
      removed_on: dzis < dostep.added_on ? dostep.added_on : dzis, ...(dostep.slot == null && pozycja != null ? { slot: pozycja } : {}),
    });
    ctx.scal({ gate_access: [zapisany] });
    const f = ctx.state.ui.form;
    f.trwa = false;
    const polecenie = polecenieUsuniecia(brama, { telefon: dostep.phone, pozycja });
    f.wynik = `<section class="karta">
        <h2>Wyślij polecenie usunięcia</h2>
        ${polecenie ? `<p>Usunięcie zapisane. Dotknij przycisku i w Wiadomościach „Wyślij”.</p>
          ${przyciskSms(brama.sim_phone, polecenie, `SMS do bramy ${brama.numer} – usuń numer`)}`
    : `<p class="baner blad"><span>Usunięcie zapisane, ale w bazie nie ma polecenia usuwania (gates.remove_template).
          Usuń numer <span class="mono">${esc(dostep.phone)}</span>${pozycja != null ? ` (pozycja ${pozycja})` : ''} ze sterownika ręcznie.</span></p>`}
        <p class="pasek-akcji"><a class="link-btn" href="#/bramy">Lista bram</a>
          <a class="link-btn" href="#/klienci/${encodeURIComponent(klient.id)}">Karta klienta</a></p>
      </section>`;
    ctx.toast(`Usunięto z bramy ${brama.numer}: ${klient.name}`);
    ctx.render();
  });
}

/** „Obecni najemcy są już w sterowniku”: dostęp bez pozycji dla klientów z trwającym najmem i bez zapisanego dostępu. */
async function oznaczWczesniej(_el, ctx) {
  const s = ctx.state;
  const dzis = dzisiaj();
  if (s.podglad || s.offline || s.zKopii) { ctx.toast('Zapis wymaga połączenia z bazą.'); return; }
  const wiersze = [];
  let bezTelefonu = 0;
  for (const x of bramyDoZrobienia(s, dzis).doPrzypisania) {
    if (!x.brama || !x.najmy.some((n) => n.start_on <= dzis)) continue;
    const telefon = telefonMiedzynarodowy(x.klient.phone);
    if (!telefon) { bezTelefonu += 1; continue; }
    wiersze.push({ id: noweId(), gate_id: x.brama.id, client_id: x.klient.id, phone: telefon, slot: null, added_on: dzis,
      note: 'wpisany wcześniej' });
  }
  try {
    ctx.scal({ gate_access: await ctx.db.zapiszWiele('gate_access', wiersze, 'id') });
    ctx.toast(`Zapisano ${odmiana(wiersze.length, ['dostęp', 'dostępy', 'dostępów'])}${bezTelefonu
      ? ` – ${bezTelefonu} klientów bez poprawnego telefonu zostało na liście` : ''}`);
  } catch (e) {
    ctx.toast(/gate_access/.test(e.message) ? 'Uruchom w Supabase migrację 012_bramy.sql.' : e.message);
  }
  if (s.ui.form) s.ui.form.potwierdzWczesniej = false;
  ctx.render();
}

export default {
  zakladka: 'klienci',
  tytul: (s) => (s.ui.parametr ? `Brama ${Number(s.ui.zapytanie.brama) || 1}: ${s.indeksy.klienci.get(s.ui.parametr)?.name ?? ''}` : 'Bramy'),
  wstecz: (s) => (s.ui.parametr
    ? { href: `#/klienci/${encodeURIComponent(s.ui.parametr)}`, tekst: s.indeksy.klienci.get(s.ui.parametr)?.name ?? 'Klient' }
    : { href: '#/pulpit', tekst: 'Pulpit' }),
  render: (s) => (s.ui.parametr ? ekranKlienta(s) : lista(s)),
  akcje: {
    wczesniej(_el, ctx) {
      stanFormularza(ctx.state, 'bramy', () => ({})).potwierdzWczesniej = true;
      ctx.render();
    },
    'wczesniej-nie'(_el, ctx) { if (ctx.state.ui.form) ctx.state.ui.form.potwierdzWczesniej = false; ctx.render(); },
    'wczesniej-tak': oznaczWczesniej,
  },
  formularze: { przypisz, 'usun-z-bramy': usun },
};

/** Karta „Bramy” na karcie klienta. */
export function kartaBramKlienta(s, klient) {
  if (!s.dane.gates?.length) return '';
  const dzis = dzisiaj();
  const stany = stanBramKlienta(s, klient.id, dzis);
  if (!stany.length) return '';
  const id = encodeURIComponent(klient.id);
  return `<section class="karta" aria-labelledby="k-bramy"><h2 id="k-bramy">Bramy</h2>
    <ul class="lista">${stany.map((b) => {
    let stan;
    if (b.dostep && b.usunOd && b.usunOd <= dzis) stan = `<span class="status zalega">usuń (od ${formatData(b.usunOd)})</span>`;
    else if (b.dostep) stan = `<span class="status ok">dostęp${b.dostep.slot != null ? ` · poz. ${b.dostep.slot}` : ''}</span>${
      b.usunOd ? `<br><span class="wyciszony maly">usunąć ${formatData(b.usunOd)}</span>` : ''}`;
    else if (b.potrzebna) stan = '<span class="status czesciowo">przypisz</span>';
    else stan = '<span class="wyciszony">bez dostępu</span>';
    return `<li><a class="wiersz" href="#/bramy/${id}?brama=${b.numer}">
      <div class="glowna"><strong>${esc(b.brama?.nazwa || `Brama ${b.numer}`)}</strong>
        <span>${b.dostep ? `<span class="mono">${esc(b.dostep.phone)}</span>` : 'telefon do bramy'}</span></div>
      <div class="prawa">${stan}</div></a></li>`;
  }).join('')}</ul></section>`;
}
