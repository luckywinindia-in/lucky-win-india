-- Lucky Win India database setup
-- Run this complete script once in Supabase Dashboard > SQL Editor.
-- It creates/repairs the profile table, creates profiles for new signups,
-- allows users to read their own profile, and allows only app_metadata.role=admin
-- to read the full account list. Never expose the service_role key in browser code.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  referral_code text,
  referred_by text,
  shares_done integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by text;
alter table public.profiles add column if not exists shares_done integer not null default 0;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

create or replace function public.lwi_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone, referred_by, referral_code, created_at)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name',''),
    nullif(new.raw_user_meta_data ->> 'phone',''),
    nullif(new.raw_user_meta_data ->> 'referred_by',''),
    upper(substr(replace(new.id::text,'-',''),1,10)),
    now()
  )
  on conflict (id) do update set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    phone = coalesce(public.profiles.phone, excluded.phone);
  return new;
end;
$$;

drop trigger if exists lwi_auth_user_profile on auth.users;
create trigger lwi_auth_user_profile
after insert on auth.users
for each row execute procedure public.lwi_create_profile();

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

drop policy if exists "Users can update own basic profile" on public.profiles;

drop policy if exists "Admin can read all profiles" on public.profiles;
create policy "Admin can read all profiles"
on public.profiles for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Backfill existing auth users that do not yet have a profile.
insert into public.profiles (id, full_name, phone, referred_by, referral_code, created_at)
select u.id,
       nullif(u.raw_user_meta_data ->> 'full_name',''),
       nullif(u.raw_user_meta_data ->> 'phone',''),
       nullif(u.raw_user_meta_data ->> 'referred_by',''),
       upper(substr(replace(u.id::text,'-',''),1,10)),
       coalesce(u.created_at, now())
from auth.users u
on conflict (id) do nothing;
