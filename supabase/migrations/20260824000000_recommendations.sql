-- AI 從全球資訊挑出來的觀察標的（每天一批）
--
-- 這張表跟 sim_ai_log 是**兩種不同的東西**，不要混在一起：
--
--   sim_ai_log      執行層。今天這個帳戶要不要買賣。理由裡的每個數字都必須
--                   存在於我們算出來的事實集合裡，否則整個回應退回重問。
--                   刻意**不給新聞**——那條軌道要可重播、不能被事後資訊汙染。
--
--   recommendations 發現層。今天全世界有什麼值得看一眼。它就是要靠新聞與
--                   題材，因為它的用途是**跳出使用者自己的清單**。
--
-- 兩者的保證因此不同，畫面上必須講清楚：執行層保證數字有出處，發現層保證
-- **敘述有來源網址**，但那些數字沒有經過這個站的計算。
--
-- 跟 sim_ai_log 一樣：**永不重算、永不覆蓋**。那天的模型說了什麼就是說了什麼，
-- 事後再問一次會得到一個知道後來發生什麼的答案，那種紀錄沒有價值。
create table if not exists recommendations (
  d          date not null,
  market     text not null check (market in ('TW', 'US')),
  code       text not null,
  name       text,
  -- 為什麼最近受關注。一句話，允許帶網路上的數字——但那些數字**沒有**經過
  -- 這個站的驗證器，所以一定要有 source 撐著。
  theme      text not null,
  -- 來源網址。沒有它這一列就沒有意義：一個沒有出處的題材跟憑空捏造分不出來。
  source     text not null,
  -- 名次（1..N）。同一天同一個市場不重複。
  rank       int not null,
  -- 這個代號在來源那邊查得到嗎。查不到的不寫進來（見 scripts/recommend.ts），
  -- 這個欄位留著記錄當時的驗證結果。
  verified   boolean not null default false,
  model      text,
  created_at timestamptz not null default now(),
  primary key (d, market, code)
);

create index if not exists recommendations_d_idx on recommendations (d desc);

alter table recommendations enable row level security;

-- 全站共用：登入者皆可讀，只有 service role 可寫（跟 symbols/daily_bars 同一條規矩）
create policy "recommendations readable" on recommendations
  for select to authenticated using (true);

grant select on recommendations to authenticated;
grant all privileges on recommendations to service_role;
