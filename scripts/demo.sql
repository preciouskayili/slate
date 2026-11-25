-- Synthetic demo data for trying Slate locally. Every name and value is fake.
create extension if not exists pgcrypto;

drop schema if exists app cascade;
drop schema if exists analytics cascade;
create schema app;
create schema analytics;

create type app.plan_tier as enum ('free', 'plus', 'team', 'enterprise');
create type app.task_status as enum ('todo', 'in_progress', 'blocked', 'done');

create table app.organizations (
  id          bigserial primary key,
  name        text not null,
  slug        text not null unique,
  tier        app.plan_tier not null default 'free',
  seats       integer not null default 1 check (seats > 0),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
comment on table app.organizations is 'Customer organizations (synthetic)';

create table app.users (
  id            uuid primary key default gen_random_uuid(),
  organization_id bigint references app.organizations(id) on delete cascade,
  email         text not null unique,
  full_name     text,
  is_admin      boolean not null default false,
  tags          text[] not null default '{}',
  last_seen_at  timestamptz,
  balance       numeric(12,2) default 0,
  created_at    timestamptz not null default now()
);
create index users_org_idx on app.users (organization_id);
comment on column app.users.email is 'Login email; unique per user';

create table app.projects (
  id              serial primary key,
  organization_id bigint not null references app.organizations(id),
  owner_id        uuid references app.users(id) on delete set null,
  name            text not null,
  description     text,
  archived        boolean not null default false,
  due_on          date,
  created_at      timestamptz not null default now()
);

create table app.tasks (
  id          bigint generated always as identity primary key,
  project_id  integer not null references app.projects(id) on delete cascade,
  assignee_id uuid references app.users(id),
  title       text not null,
  status      app.task_status not null default 'todo',
  priority    smallint not null default 2,
  estimate_hours real,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_status_idx on app.tasks (status) where status <> 'done';

create table app.audit_log (
  occurred_at timestamptz not null default now(),
  actor       text,
  action      text not null,
  payload     jsonb
);
comment on table app.audit_log is 'Append-only log with no primary key';

create table analytics.daily_signups (
  day      date primary key,
  signups  integer not null,
  source   text
);

-- data
insert into app.organizations (name, slug, tier, seats, settings, created_at)
select 'Org ' || initcap(w), lower(w) || '-' || g, (array['free','plus','team','enterprise']::app.plan_tier[])[1 + g % 4],
       1 + (g * 7) % 40, jsonb_build_object('theme', (array['light','dark'])[1 + g % 2], 'beta', g % 3 = 0),
       now() - (g || ' days')::interval
from generate_series(1, 40) g,
     lateral (select (array['acme','globex','initech','umbrella','hooli','vandelay','stark','wayne','tyrell','cyberdyne'])[1 + g % 10] as w) x;

insert into app.users (organization_id, email, full_name, is_admin, tags, last_seen_at, balance, created_at)
select 1 + g % 40,
       'user' || g || '@example.test',
       (array['Alex','Sam','Jordan','Taylor','Morgan','Riley','Casey','Quinn','Avery','Jamie'])[1 + g % 10] || ' ' ||
       (array['Rivera','Chen','Okafor','Silva','Nguyen','Kowalski','Haddad','Mensah','Larsen','Ito'])[1 + (g / 10) % 10],
       g % 17 = 0,
       case when g % 3 = 0 then array['beta','early'] when g % 5 = 0 then array['vip'] else '{}' end,
       case when g % 9 = 0 then null else now() - ((g * 13) % 500 || ' hours')::interval end,
       round((random() * 500)::numeric, 2),
       now() - ((g * 7) % 900 || ' hours')::interval
from generate_series(1, 1200) g;

insert into app.projects (organization_id, owner_id, name, description, archived, due_on)
select 1 + g % 40, (select id from app.users order by email offset (g * 11) % 1200 limit 1),
       (array['Launch','Migration','Redesign','Audit','Onboarding','Research'])[1 + g % 6] || ' ' || g,
       case when g % 4 = 0 then null else 'Synthetic project number ' || g end,
       g % 7 = 0, current_date + (g % 90 - 30)
from generate_series(1, 150) g;

insert into app.tasks (project_id, assignee_id, title, status, priority, estimate_hours, metadata, completed_at)
select 1 + g % 150, (select id from app.users order by created_at offset (g * 3) % 1200 limit 1),
       (array['Write spec','Fix bug','Review PR','Update docs','Plan sprint','Ship release','Design review'])[1 + g % 7] || ' #' || g,
       (array['todo','in_progress','blocked','done']::app.task_status[])[1 + g % 4],
       g % 4, case when g % 5 = 0 then null else (g % 16) / 2.0 end,
       case when g % 2 = 0 then jsonb_build_object('labels', jsonb_build_array('backend', 'p' || g % 3), 'points', g % 8) end,
       case when g % 4 = 3 then now() - (g % 30 || ' days')::interval end
from generate_series(1, 5000) g;

insert into app.audit_log (occurred_at, actor, action, payload)
select now() - (g || ' minutes')::interval, 'user' || (g % 50) || '@example.test',
       (array['login','logout','update','delete','export'])[1 + g % 5], jsonb_build_object('ip', '10.0.' || g % 255 || '.' || g % 7)
from generate_series(1, 300) g;

insert into analytics.daily_signups
select current_date - g, (50 + 40 * sin(g / 5.0) + random() * 20)::int, (array['organic','ads','referral'])[1 + g % 3]
from generate_series(0, 365) g;

create view app.active_projects as
  select p.id, p.name, o.name as organization, count(t.id) as open_tasks
  from app.projects p join app.organizations o on o.id = p.organization_id
  left join app.tasks t on t.project_id = p.id and t.status <> 'done'
  where not p.archived group by p.id, o.name;

create materialized view analytics.signups_by_month as
  select date_trunc('month', day)::date as month, sum(signups) as signups from analytics.daily_signups group by 1;

create function app.org_user_count(org bigint) returns bigint language sql stable as
  $$ select count(*) from app.users where organization_id = org $$;

analyze;
