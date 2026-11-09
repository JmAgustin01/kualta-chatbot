-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

create extension if not exists vector;

create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,             -- file name, e.g. "services.md" or "privacy.qa.json"
  title       text,                      -- page title or the Q&A question
  content     text not null,             -- the chunk text sent to the LLM
  embedding   vector(1536) not null,     -- text-embedding-3-small
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index if not exists documents_source_idx on public.documents (source);
create index if not exists documents_embedding_idx
  on public.documents using hnsw (embedding vector_cosine_ops);

-- Lock the table down: only the server (service role key) can read/write.
-- The anon/public key gets nothing because there are no policies.
alter table public.documents enable row level security;

-- Similarity search used by src/rag/vectorStore.js
create or replace function public.match_documents (
  query_embedding vector(1536),
  match_count     int   default 4,
  min_similarity  float default 0
)
returns table (id uuid, source text, title text, content text, similarity float)
language sql stable
as $$
  select d.id, d.source, d.title, d.content,
         1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where 1 - (d.embedding <=> query_embedding) >= min_similarity
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_documents(vector, int, float) from public, anon, authenticated;

-- =====================================================================
-- Business rules support: sessions, leads, logs, retention (CB-08..CB-20)
-- =====================================================================

-- Conversation state (lead-capture step, failed-answer count, abuse strikes)
create table if not exists public.chat_sessions (
  user_key    text primary key,               -- "fb:<sha256>" (no raw Messenger IDs)
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Leads: stored ONLY after the user consents (CB-09, BR-01, BR-20)
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  user_key       text not null,
  channel        text not null,
  name           text not null,
  email          text not null,
  phone          text not null,
  business_name  text not null,
  service        text not null,
  consent_at     timestamptz not null,
  privacy_notice text not null,               -- the exact notice the user agreed to
  after_hours    boolean,
  created_at     timestamptz not null default now()
);
create index if not exists leads_user_key_idx on public.leads (user_key);

-- One row per message: intent, rule, sources, escalation (CB-20). Text is redacted (CB-17).
create table if not exists public.message_logs (
  id              bigint generated always as identity primary key,
  user_key        text not null,
  channel         text not null,
  text_redacted   text,
  intent          text,
  rule_id         text,
  route           text,
  sources         text[] default '{}',
  escalated       boolean not null default false,
  top_similarity  float,
  flagged         text,                       -- 'prohibited' | 'abuse' | 'chat_ended' | null
  created_at      timestamptz not null default now()
);
create index if not exists message_logs_user_key_idx on public.message_logs (user_key);
create index if not exists message_logs_created_idx on public.message_logs (created_at);

alter table public.chat_sessions enable row level security;
alter table public.leads         enable row level security;
alter table public.message_logs  enable row level security;

-- "DELETE MY DATA" (CB-19)
create or replace function public.delete_user_data (p_user_key text)
returns jsonb
language plpgsql
as $$
declare n_leads int; n_logs int;
begin
  delete from public.leads where user_key = p_user_key;          get diagnostics n_leads = row_count;
  delete from public.message_logs where user_key = p_user_key;   get diagnostics n_logs = row_count;
  delete from public.chat_sessions where user_key = p_user_key;
  return jsonb_build_object('leads', n_leads, 'logs', n_logs);
end;
$$;

-- 12-month retention (CB-19, BR-20). Sessions expire after 30 days of inactivity.
create or replace function public.purge_expired_data ()
returns jsonb
language plpgsql
as $$
declare n_leads int; n_logs int; n_sessions int;
begin
  delete from public.leads         where created_at < now() - interval '12 months'; get diagnostics n_leads = row_count;
  delete from public.message_logs  where created_at < now() - interval '12 months'; get diagnostics n_logs = row_count;
  delete from public.chat_sessions where updated_at < now() - interval '30 days';   get diagnostics n_sessions = row_count;
  return jsonb_build_object('leads', n_leads, 'logs', n_logs, 'sessions', n_sessions);
end;
$$;

revoke all on function public.delete_user_data(text)  from public, anon, authenticated;
revoke all on function public.purge_expired_data()    from public, anon, authenticated;

-- Run the purge daily at 03:00 UTC. Enable the pg_cron extension first:
-- Dashboard > Database > Extensions > pg_cron > Enable. Then run:
--   select cron.schedule('purge-expired-data', '0 3 * * *', $$select public.purge_expired_data()$$);
