-- 區分「當天真的產出的建議」與「事後用現在的規則回補的」。
--
-- 這兩者看起來一樣，意義卻完全相反：
--   live      當天我們就是這樣說的。規則之後怎麼改都不能動它。
--   backfill  用**現在**的規則回頭算的。規則一改，這些值就會跟著變。
--
-- 混在一起的話，回顧會變成自我證明：規則調到好看為止，然後回補一份漂亮的歷史。
-- 所以分開標記，回顧頁也要分開呈現。
alter table daily_analysis
  add column if not exists origin text not null default 'live'
    check (origin in ('live', 'backfill')),
  add column if not exists rules_version text;

comment on column daily_analysis.origin is
  'live=當天實際產出，永不重算；backfill=事後用當時的規則版本回補';

create index if not exists daily_analysis_origin_idx on daily_analysis (symbol_id, origin, d desc);
