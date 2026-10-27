-- Cover photos for the four Diriyah projects: free-licence photos of Diriyah from Wikimedia Commons,
-- shipped with the app under /covers/ and credited on each project page (src/lib/covers.ts).
-- Only where a project has no cover yet, so a photo someone already chose stays.
update public.projects set cover_url = '/covers/bawabah-at-turaif.jpg' where name = 'Bawabah' and cover_url is null;
update public.projects set cover_url = '/covers/capella-at-turaif.jpg' where name = 'Capella' and cover_url is null;
update public.projects set cover_url = '/covers/hoas-palm-gardens.jpg' where name = 'HOAS' and cover_url is null;
update public.projects set cover_url = '/covers/ksu-wadi-hanifah.jpg' where name = 'KSU' and cover_url is null;
