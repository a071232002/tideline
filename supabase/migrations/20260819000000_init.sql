-- Tideline 初始 schema（PLAN §6）
-- 原則：daily_bars 只留半年＋暖機可以清；daily_analysis 一列都不能刪，
-- 它是日後回顧的唯一素材（PLAN §11）。

create table if not exists symbols (
  id           uuid primary key default gen_random_uuid(),
  market       text not null check (market in ('TW','US')),
  code         text not null,
  yahoo_symbol text not null,
  name_zh      text,
  name_en      text,
  currency     text not null,
  created_at   timestamptz not null default now(),
  unique (market, code)
);

create table if not exists watchlist (
  user_id    uuid not null references auth.users(id) on delete cascade,
  symbol_id  uuid not null references symbols(id) on delete cascade,
  sort_order int not null default 100,
  added_at   timestamptz not null default now(),
  primary key (user_id, symbol_id)
);

-- 原始價與還原價都存：指標吃還原價，頁面顯示原始價（PLAN §2）
create table if not exists daily_bars (
  symbol_id  uuid not null references symbols(id) on delete cascade,
  d          date not null,
  o numeric, h numeric, l numeric, c numeric, v bigint,
  o_adj numeric, h_adj numeric, l_adj numeric, c_adj numeric,
  adj_factor numeric not null default 1,
  src        text not null,
  primary key (symbol_id, d)
);

-- 全部由程式寫，AI 不碰
create table if not exists daily_analysis (
  symbol_id uuid not null references symbols(id) on delete cascade,
  d         date not null,
  close numeric not null, chg numeric, chg_pct numeric,
  o numeric, h numeric, l numeric,
  k numeric, d_val numeric,
  bb_mid numeric, bb_up numeric, bb_lo numeric, pct_b numeric, bandwidth numeric,
  ma60 numeric,
  levels  jsonb not null,
  verdict jsonb not null,
  created_at timestamptz not null default now(),
  primary key (symbol_id, d)
);

-- 與上表分開：AI 可能失敗、可能晚到、可能整天都沒有
create table if not exists daily_commentary (
  symbol_id  uuid not null references symbols(id) on delete cascade,
  d          date not null,
  headline   text not null,
  reasons    jsonb not null,
  level_why  jsonb not null,
  macro      text,
  model      text not null,
  created_at timestamptz not null default now(),
  primary key (symbol_id, d)
);

create table if not exists symbol_profile (
  symbol_id uuid primary key references symbols(id) on delete cascade,
  sector    text,
  peers     jsonb not null default '[]',
  drivers   jsonb not null default '[]',
  note_zh   text,
  edited_by_user boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists market_context (
  market text not null check (market in ('TW','US')),
  d      date not null,
  data   jsonb not null,
  primary key (market, d)
);

-- Vercel Cron 失敗不會寄信，靠這張表讓頁面自己說「資料未更新」（PLAN §7）
create table if not exists job_runs (
  id          bigserial primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  processed   int,
  error       text
);

create index if not exists daily_bars_symbol_d_idx on daily_bars (symbol_id, d desc);
create index if not exists daily_analysis_symbol_d_idx on daily_analysis (symbol_id, d desc);
create index if not exists job_runs_job_started_idx on job_runs (job, started_at desc);

-- ---------------------------------------------------------------- RLS
alter table symbols          enable row level security;
alter table watchlist        enable row level security;
alter table daily_bars       enable row level security;
alter table daily_analysis   enable row level security;
alter table daily_commentary enable row level security;
alter table symbol_profile   enable row level security;
alter table market_context   enable row level security;
alter table job_runs         enable row level security;

-- 全站共用的資料：登入者皆可讀，只有 service role 可寫
create policy "symbols readable" on symbols
  for select to authenticated using (true);
create policy "bars readable" on daily_bars
  for select to authenticated using (true);
create policy "analysis readable" on daily_analysis
  for select to authenticated using (true);
create policy "commentary readable" on daily_commentary
  for select to authenticated using (true);
create policy "profile readable" on symbol_profile
  for select to authenticated using (true);
create policy "context readable" on market_context
  for select to authenticated using (true);
create policy "jobs readable" on job_runs
  for select to authenticated using (true);

-- 觀察清單只有本人讀寫
create policy "own watchlist select" on watchlist
  for select to authenticated using (auth.uid() = user_id);
create policy "own watchlist insert" on watchlist
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own watchlist update" on watchlist
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own watchlist delete" on watchlist
  for delete to authenticated using (auth.uid() = user_id);
