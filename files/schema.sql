-- Room Khata: run this whole file once in Supabase -> SQL Editor

-- ========== TABLES ==========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table public.members (
  room_id uuid references public.rooms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (room_id, user_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  added_by uuid not null references public.profiles(id),
  title text not null,
  amount numeric(10,2) not null check (amount > 0),
  spent_on date not null,
  type text not null check (type in ('usage', 'fixed')),
  created_at timestamptz default now()
);

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  from_date date not null,
  to_date date not null,
  check (to_date >= from_date)
);

-- ========== AUTO-CREATE PROFILE ON SIGNUP ==========
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== HELPER: is the logged-in user in this room? ==========
create or replace function public.is_member(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members where room_id = rid and user_id = auth.uid()
  );
$$;

-- ========== CREATE / JOIN ROOM ==========
create or replace function public.create_room(room_name text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  new_room public.rooms;
  new_code text;
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  loop
    new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.rooms where code = new_code);
  end loop;
  insert into public.rooms (name, code, created_by)
    values (trim(room_name), new_code, auth.uid()) returning * into new_room;
  insert into public.members (room_id, user_id) values (new_room.id, auth.uid());
  return new_room;
end $$;

create or replace function public.join_room(room_code text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  found_room public.rooms;
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  select * into found_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'Invalid room code'; end if;
  insert into public.members (room_id, user_id) values (found_room.id, auth.uid())
    on conflict do nothing;
  return found_room;
end $$;

-- ========== SECURITY (who can see / change what) ==========
alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.members  enable row level security;
alter table public.expenses enable row level security;
alter table public.absences enable row level security;

create policy "profiles readable" on public.profiles
  for select to authenticated using (true);

create policy "rooms visible to members" on public.rooms
  for select to authenticated using (public.is_member(id));

create policy "members visible to roommates" on public.members
  for select to authenticated using (public.is_member(room_id));

create policy "expenses visible to members" on public.expenses
  for select to authenticated using (public.is_member(room_id));
create policy "members add expenses" on public.expenses
  for insert to authenticated with check (public.is_member(room_id) and added_by = auth.uid());
create policy "delete own expenses" on public.expenses
  for delete to authenticated using (added_by = auth.uid());

create policy "absences visible to members" on public.absences
  for select to authenticated using (public.is_member(room_id));
create policy "add own absence" on public.absences
  for insert to authenticated with check (public.is_member(room_id) and user_id = auth.uid());
create policy "delete own absence" on public.absences
  for delete to authenticated using (user_id = auth.uid());
