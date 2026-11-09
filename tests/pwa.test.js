// Spójność plików PWA: lista PLIKI w sw.js, manifest, odwołania w index.html i importy modułów.
// Chroni przed klasycznym błędem: nowy plik nie trafia do pamięci podręcznej i aplikacja offline się sypie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const KORZEN = join(dirname(fileURLToPath(import.meta.url)), '..');
const czytaj = (p) => readFile(join(KORZEN, p), 'utf8');
const istnieje = (p) => access(join(KORZEN, p)).then(() => true, () => false);

async function plikiW(katalog) {
  const wynik = [];
  for (const wpis of await readdir(join(KORZEN, katalog), { withFileTypes: true })) {
    const sciezka = posix.join(katalog, wpis.name);
    if (wpis.isDirectory()) wynik.push(...await plikiW(sciezka));
    else if (!/LICENSE|\.txt$|\.md$/.test(wpis.name)) wynik.push(sciezka);
  }
  return wynik;
}

async function listaZSw() {
  const sw = await czytaj('sw.js');
  const blok = /const PLIKI = \[([\s\S]*?)\];/.exec(sw)[1];
  return [...blok.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('sw.js: każdy plik aplikacji jest na liście PLIKI i każdy wpis istnieje', async () => {
  const lista = await listaZSw();
  const naDysku = ['index.html', 'manifest.webmanifest',
    ...(await Promise.all(['css', 'js', 'icons', 'fonts'].map(plikiW))).flat()];
  const brakujace = naDysku.filter((p) => !lista.includes(p));
  assert.deepEqual(brakujace, [], 'pliki spoza pamięci podręcznej');
  for (const p of lista.filter((x) => x !== './')) assert.ok(await istnieje(p), `brak pliku: ${p}`);
  assert.equal(new Set(lista).size, lista.length, 'duplikaty na liście');
});

test('manifest: tryb standalone, ikony 192 i 512 oraz maskable istnieją', async () => {
  const m = JSON.parse(await czytaj('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.lang, 'pl');
  const rozmiary = m.icons.map((i) => i.sizes);
  assert.ok(rozmiary.includes('192x192') && rozmiary.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(await istnieje(i.src), `brak ikony: ${i.src}`);
});

test('index.html: odwołania do plików istnieją, są elementy wymagane przez app.js', async () => {
  const html = await czytaj('index.html');
  const odwolania = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
  for (const p of odwolania) assert.ok(await istnieje(p), `brak pliku: ${p}`);
  const app = await czytaj('js/app.js');
  const idZApp = [...app.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);
  for (const id of new Set([...idZApp, 'toast'])) assert.match(html, new RegExp(`id="${id}"`), `brak #${id}`);
  assert.match(html, /<h1 id="tytul" tabindex="-1"/, 'tytuł musi przyjmować fokus po zmianie ekranu');
});

test('moduły JS: każdy import względny wskazuje istniejący plik', async () => {
  const pliki = (await plikiW('js')).filter((p) => p.endsWith('.js') && !p.includes('vendor'));
  for (const p of pliki) {
    const kod = await czytaj(p);
    for (const [, cel] of kod.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
      const sciezka = posix.join(posix.dirname(p), cel);
      assert.ok(await istnieje(sciezka), `${p}: brak modułu ${cel}`);
    }
  }
});
