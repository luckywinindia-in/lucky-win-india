-- Lucky Win India admin read access
-- Run in Supabase Dashboard > SQL Editor as project owner.
-- Then grant the admin role to your own Auth user in Authentication > Users > user > Raw app metadata:
-- {"role":"admin"}
-- Never put the service_role key in browser code.

alter table public.profiles enable row level security;

drop policy if exists "Admin can read all profiles" on public.profiles;
create policy "Admin can read all profiles"
on public.profiles
for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
