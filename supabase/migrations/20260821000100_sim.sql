-- 模擬帳戶（PLAN §13）。
--
-- 三張表都**永久保留**，理由與 daily_analysis 相同（§11）：這是回顧的素材，
-- 刪掉補不回來。一檔一年 250 列，十檔十年也才 25000 列，留著幾乎沒有成本。
--
-- 三條軌道跑同一組 K 棒，差別只在誰做決定：
--   rule  §4 的價位規則，寫死的。**AI 的對照組**
--   ai    每天看資訊自己判斷，沒有硬性進出場規定。目標是報酬率
--   hold  第一天全押、之後不動。**沒有它，上漲的市場裡任何策略都很好看**

create table if not exists sim_accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  symbol_id    uuid not null references symbols(id) on delete cascade,
  track        text not null check (track in ('rule','ai','hold')),
  initial_twd  numeric not null default 50000 check (initial_twd > 0),
  initial_cash numeric not null check (initial_cash > 0),  -- 換算後的計價幣別本金
  currency     text not null,
  fx_at_open   numeric,        -- 建帳當日匯率，US 才有；TW 是 null
  params       jsonb not null default '{}'::jsonb,
  started_on   date not null,  -- 這條軌道從哪天開始。AI 那條不能回補，起跑點會比較晚
  created_at   timestamptz not null default now(),
  unique (user_id, symbol_id, track)
);

-- 一天最多一筆成交（同日買賣已在引擎裡相抵，§13.4），所以 unique 到 signal_d 就夠
create table if not exists sim_trades (
  id            bigserial primary key,
  account_id    uuid not null references sim_accounts(id) on delete cascade,
  signal_d      date not null,   -- 訊號日（收盤後算出來的）
  fill_d        date not null,   -- 成交日（訊號日的次一交易日）
  side          text not null check (side in ('buy','sell')),
  qty           numeric not null check (qty > 0),
  price         numeric not null check (price > 0),
  fee           numeric not null default 0,
  tax           numeric not null default 0,
  triggers      jsonb not null default '[]'::jsonb,
  decided_by    text not null check (decided_by in ('rule','ai')),
  confidence    text,            -- AI 才有
  -- AI 選擇抱過止跌價位。不擋它，但讓它自己現形（§13.5）
  overrode_stop boolean not null default false,
  reason        text,
  origin        text not null default 'live' check (origin in ('live','backfill')),
  rules_version text,
  params_version text,
  created_at    timestamptz not null default now(),
  unique (account_id, signal_d)
);

create table if not exists sim_equity (
  account_id uuid not null references sim_accounts(id) on delete cascade,
  d          date not null,
  cash       numeric not null,
  shares     numeric not null,
  mark       numeric not null,   -- 當日收盤，與訊號同一個價格空間（原始價）
  equity     numeric not null,   -- cash + shares × mark
  ret_pct    numeric not null,   -- 相對 initial_cash
  primary key (account_id, d)
);

-- AI 沒跑到的日子要留下痕跡。電腦沒開、模型失敗、逾時、驗證器連續退回都算。
-- **事後不補**——補了就是偷看未來（§13.1 四）。頁面要顯示有幾天是 missing，
-- 一半以上都 missing 的曲線不能拿來比較。
create table if not exists sim_ai_log (
  account_id uuid not null references sim_accounts(id) on delete cascade,
  d          date not null,
  status     text not null check (status in ('ok','missing','rejected')),
  action     text,
  confidence text,
  reason     text,
  model      text,
  note       text,
  created_at timestamptz not null default now(),
  primary key (account_id, d)
);

create index if not exists sim_trades_account_d_idx on sim_trades (account_id, signal_d desc);
create index if not exists sim_equity_account_d_idx on sim_equity (account_id, d desc);
create index if not exists sim_accounts_user_symbol_idx on sim_accounts (user_id, symbol_id);

-- ---------------------------------------------------------------- RLS
-- 帳戶是 per-user 的，照 watchlist 那組寫。子表沒有 user_id，
-- 用 exists 回查母表——RLS 決定哪幾列，GRANT 決定能不能碰這張表，兩個都要給。
alter table sim_accounts enable row level security;
alter table sim_trades   enable row level security;
alter table sim_equity   enable row level security;
alter table sim_ai_log   enable row level security;

create policy "own sim_accounts select" on sim_accounts
  for select to authenticated using (auth.uid() = user_id);
create policy "own sim_accounts insert" on sim_accounts
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own sim_accounts update" on sim_accounts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sim_accounts delete" on sim_accounts
  for delete to authenticated using (auth.uid() = user_id);

create policy "own sim_trades select" on sim_trades
  for select to authenticated using (exists (
    select 1 from sim_accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy "own sim_equity select" on sim_equity
  for select to authenticated using (exists (
    select 1 from sim_accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy "own sim_ai_log select" on sim_ai_log
  for select to authenticated using (exists (
    select 1 from sim_accounts a where a.id = account_id and a.user_id = auth.uid()));

grant select, insert, update, delete on sim_accounts to authenticated;
grant select on sim_trades, sim_equity, sim_ai_log to authenticated;
grant all privileges on sim_accounts, sim_trades, sim_equity, sim_ai_log to service_role;
grant usage, select on sequence sim_trades_id_seq to service_role;
