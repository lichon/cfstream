create table IF not exists public.stream_rooms (
  id text not null,
  created_at timestamp with time zone not null default now(),
  secret text null,
  name text null,
  constraint stream_rooms_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists stream_rooms_name_idx on public.stream_rooms using btree (name) TABLESPACE pg_default;

create table IF not exists public.stream_subs (
  id text not null,
  created_at timestamp with time zone not null default now(),
  sub_sid text not null,
  constraint stream_subs_pkey primary key (id, sub_sid)
) TABLESPACE pg_default;

create table IF not exists public.signals (
  sid text not null default ''::text,
  created_at timestamp with time zone not null default now(),
  offer text null,
  answer text null,
  constraint signals_pkey primary key (sid)
) TABLESPACE pg_default;
