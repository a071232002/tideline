-- 估值：本益比、殖利率、股價淨值比。
--
-- 獨立一張表而不是塞進 daily_analysis，因為它是**另一種資訊**：
-- daily_analysis 全部來自我們自己算的技術指標，這裡是外部給的基本面數字。
-- 混在一起會讓「這個欄位是誰算的」變得說不清楚。
--
-- 也不是每檔都有：ETF 沒有本益比、虧損公司沒有 trailing PE。
-- 沒有就不寫，頁面自己說明原因，不要填 0 假裝有。
create table if not exists daily_valuation (
  symbol_id      uuid not null references symbols(id) on delete cascade,
  d              date not null,
  pe             numeric,
  forward_pe     numeric,
  pb             numeric,
  dividend_yield numeric,   -- 百分比，0.94 代表 0.94%
  src            text not null,
  created_at     timestamptz not null default now(),
  primary key (symbol_id, d)
);

create index if not exists daily_valuation_symbol_d_idx on daily_valuation (symbol_id, d desc);

alter table daily_valuation enable row level security;
create policy "valuation readable" on daily_valuation
  for select to authenticated using (true);
grant select on daily_valuation to authenticated;
grant all privileges on daily_valuation to service_role;
