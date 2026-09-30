-- 01-setup.sql - Coal Dispatch & Transportation Monitoring (MCL)
-- Run this ONCE in the Supabase SQL Editor (paste everything, press Run).
-- One row = one truck trip (mine -> destination/siding -> back).
-- Urgency Low / Medium / High = cycle time Normal / Attention / Exception.
-- Status Open / In progress / Resolved = trip not started / on the road / trip finished.

create table public.dispatch_trips (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  trip_date      date not null,
  shift          text not null check (shift in ('A', 'B', 'C')),
  mine           text not null,
  mode           text not null check (mode in ('Road', 'Siding')),
  location       text not null check (location in ('Sundargarh', 'Raigarh', 'Laikera', 'Kanika')),
  destination    text not null,
  customer       text not null,
  transporter    text not null,
  vehicle_no     text not null,
  vehicle_type   text not null,
  payload_mt     numeric(7, 2) not null check (payload_mt >= 0),
  distance_km    numeric(7, 1),
  departure_time timestamptz not null,
  return_time    timestamptz,
  loading_min    integer,
  queue_min      integer,
  travel_min     integer,
  unloading_min  integer,
  urgency        text not null default 'Low' check (urgency in ('Low', 'Medium', 'High')),
  status         text not null default 'Open' check (status in ('Open', 'In progress', 'Resolved'))
);

create index dispatch_trips_date_idx on public.dispatch_trips (trip_date);

alter table public.dispatch_trips enable row level security;

create policy "dispatch_trips_select" on public.dispatch_trips
  for select to anon, authenticated using (true);

create policy "dispatch_trips_insert" on public.dispatch_trips
  for insert to anon, authenticated with check (true);

create policy "dispatch_trips_update" on public.dispatch_trips
  for update to anon, authenticated using (true) with check (true);

grant select, insert, update on public.dispatch_trips to anon, authenticated;
