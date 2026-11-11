-- 011 (wersja 0.17.0). Uruchomić w Supabase → SQL Editor po 010 (ponowne uruchomienie nic nie psuje).
-- Wzory umów do podpisania (prośba z 11.11.2026):
--  * settings.contract_templates – lista wzorów: [{ id, nazwa, plik, wgrano }]; plik w buckecie „umowy”
--    jako {user_id}/wzory/{id}.docx (ta sama polityka „własny folder” co PDF-y umów),
--  * bucket „umowy” przyjmuje oprócz PDF także pliki Word (.docx).
-- Kolumna dopuszcza null, więc kopie zapasowe sprzed tej wersji wczytują się bez zmian (wczytaj_kopie).

alter table public.settings add column if not exists contract_templates jsonb;

comment on column public.settings.contract_templates is
  'Wzory umów: [{ id, nazwa, plik (nazwa pliku od użytkownika), wgrano (ISO) }]; plik: umowy/{user_id}/wzory/{id}.docx';

update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
  where id = 'umowy';
