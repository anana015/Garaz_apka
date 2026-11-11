-- =====================================================================
-- JEDNORAZOWO (11.11.2026): garaż G18R1 (rząd 1, nr 18) – istnieje, ale jest wyłączony z najmu.
-- Supabase → SQL Editor → wklej cały plik → Run. Ponowne uruchomienie nic nie psuje.
--
-- Gdy G18R1 już jest w bazie – ustawia „Wyłączona z najmu”. Gdy go nie ma – dopisuje go jako garaż
-- wyłączony z najmu (właściciel = ten sam użytkownik co pozostałe jednostki; w SQL Editor auth.uid() jest puste).
-- Mapa w aplikacji pokazuje to miejsce jako wyłączone także przed uruchomieniem tego pliku.
-- =====================================================================

update public.units set out_of_service = true, archived = false
where upper(code) = 'G18R1';

insert into public.units (user_id, code, type, out_of_service, description)
select u.user_id, 'G18R1', 'garaz', true, 'Wyłączony z najmu (11.11.2026)'
from (select user_id from public.units group by user_id order by count(*) desc limit 1) u
where not exists (select 1 from public.units where upper(code) = 'G18R1');

select code, type, out_of_service, archived from public.units where upper(code) = 'G18R1';
