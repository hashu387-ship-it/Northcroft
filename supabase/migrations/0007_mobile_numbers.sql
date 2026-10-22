-- Mobile numbers are stored one way, +9665XXXXXXXX, so WhatsApp and call links always work.
-- The app asks everyone for a photo and a +966 mobile number after they sign in.

-- Bring numbers typed earlier (05..., 5..., 966..., +966 ...) into the standard format.
update public.profiles
set phone = '+966' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
where phone is not null
  and regexp_replace(phone, '[^0-9]', '', 'g') ~ '^(966|0)?5[0-9]{8}$'
  and phone is distinct from '+966' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 9);

-- Anything that isn't a Saudi mobile is cleared, so the person is asked for it again.
update public.profiles
set phone = null
where phone is not null and phone !~ '^\+9665[0-9]{8}$';

alter table public.profiles
  add constraint profiles_phone_saudi_mobile check (phone is null or phone ~ '^\+9665[0-9]{8}$');
