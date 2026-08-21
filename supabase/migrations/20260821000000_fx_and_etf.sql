-- 模擬帳戶的兩個前置資料（PLAN §13.2、§13.3）。
--
-- 一、匯率。美股帳戶的本金是「5 萬台幣換算成美元」，帳內用美元記帳，
--     顯示合計時換回台幣。少了它，台股與美股的報酬率沒辦法放在同一張表上比。
--     每天一筆，缺漏時由程式沿用**之前**最後一筆（src/lib/sources/fx.ts 的 rateOn），
--     不是在這裡補值——補在資料庫裡就分不出「真的抓到」與「沿用」了。
--
-- 二、是不是 ETF。台股證交稅：ETF 0.1%、個股 0.3%，差三倍。
--     0050 每賣一次差 0.2%，這套規則半年進出十來趟，差距大到會改變結論。

create table if not exists fx_rates (
  d          date not null,
  pair       text not null,          -- 'USDTWD'
  rate       numeric not null check (rate > 0),
  src        text not null,
  created_at timestamptz not null default now(),
  primary key (d, pair)
);

create index if not exists fx_rates_pair_d_idx on fx_rates (pair, d desc);

alter table fx_rates enable row level security;
create policy "fx readable" on fx_rates
  for select to authenticated using (true);
grant select on fx_rates to authenticated;
grant all privileges on fx_rates to service_role;

-- 預設 false：報錯的方向要安全。誤把 ETF 當個股是多付稅（帳戶績效偏保守），
-- 誤把個股當 ETF 是少付稅（績效虛高）。寧可保守。
alter table symbols
  add column if not exists is_etf boolean not null default false;

comment on column symbols.is_etf is
  '台股證交稅率：true=0.1%（ETF）、false=0.3%（個股）。美股不使用';

update symbols set is_etf = true
  where market = 'TW' and code in ('0050', '0056', '006208', '00878', '00919', '00929');

-- 三、公司行動（配息與分割）。
--
-- 模擬帳戶用**原始價**成交（與訊號同一個價格空間，PLAN §13.3），所以除權息
-- 必須另外處理，否則帳戶會白白吃掉除息那段跌幅、卻收不到股利：
--   配息 → 除息日按持股數領現金
--   分割 → 分割日按比例調整股數
--
-- 台股的事件只能從 Yahoo 拿（TWSE 的個股日成交不回這個）。抓不到就是沒有，
-- 記進 job_runs 讓人看得到，不要擋住當天的抓取。
create table if not exists corporate_actions (
  symbol_id  uuid not null references symbols(id) on delete cascade,
  d          date not null,           -- 除息日／分割生效日
  kind       text not null check (kind in ('dividend','split')),
  amount     numeric not null check (amount > 0),  -- 配息=每股金額；分割=1 股變幾股
  src        text not null,
  created_at timestamptz not null default now(),
  primary key (symbol_id, d, kind)
);

alter table corporate_actions enable row level security;
create policy "actions readable" on corporate_actions
  for select to authenticated using (true);
grant select on corporate_actions to authenticated;
grant all privileges on corporate_actions to service_role;
