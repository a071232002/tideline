-- 買賣的歷程。**這張表只進不出。**
--
-- ## 為什麼需要它
--
-- `sim_trades` 是推導出來的：每次重建都先刪光再寫回去（見 run.ts 的
-- writeTrack——不用 upsert 是因為規則改了之後成交筆數可能變少，
-- upsert 不會移除已經不該存在的那幾筆）。
--
-- 代價是**它不是紀錄，是重算的結果**。實測 2026-08-29（週六，沒有開市）：
-- 改完 coreFraction 之後重建，週五憑空多出三筆成交，而那一天實際上什麼
-- 都沒發生過。畫面上那兩者長得一模一樣，而且沒有任何地方看得出來
-- 「這筆是今天才生出來的」。
--
-- 這張表補上那一段：**系統每一次算出來的每一筆買賣，都留下一列**，
-- 帶著算它的時間與當時的參數版本。之後要審視「哪裡有問題」，
-- 靠的是這張表，不是 sim_trades。
--
-- ## 為什麼是 fingerprint 而不是覆蓋
--
-- 同一天同一邊算出一模一樣的結果 → 不重複記（重建每天都跑，不然一年
-- 幾萬列都在講同一件事）。但只要**內容變了**就是新的一列，兩列都留著
-- ——那正是要看的東西：08-28 的那筆先前記成 X，後來變成 Y，
-- 中間參數從 V1 換成了 V2。覆蓋掉就沒有歷程了。

create table if not exists sim_trade_log (
  id             bigserial primary key,
  account_id     uuid not null references sim_accounts(id) on delete cascade,
  signal_d       date not null,
  fill_d         date not null,
  side           text not null check (side in ('buy', 'sell')),
  qty            numeric not null,
  price          numeric not null,
  fee            numeric not null default 0,
  tax            numeric not null default 0,
  triggers       text[] not null default '{}',
  decided_by     text not null,
  reason         text,
  -- 算這一筆的時候用的是哪一組規則。少了它，看到兩列不同也不知道為什麼
  params_version text not null,
  -- 第一次算出這個結果的時間。不是成交時間，是**系統這樣說的時間**
  recorded_at    timestamptz not null default now(),
  -- qty|price|triggers。一樣就不重記，不一樣就是新的一列
  fingerprint    text not null,
  unique (account_id, signal_d, side, fingerprint)
);

create index if not exists sim_trade_log_account_idx
  on sim_trade_log (account_id, signal_d desc);

alter table sim_trade_log enable row level security;

create policy "own sim_trade_log select" on sim_trade_log
  for select to authenticated using (exists (
    select 1 from sim_accounts a where a.id = account_id and a.user_id = auth.uid()));

grant select on sim_trade_log to authenticated;
grant all privileges on sim_trade_log to service_role;
grant usage, select on sequence sim_trade_log_id_seq to service_role;
