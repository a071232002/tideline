-- AI 帳戶要用到的兩個欄位（PLAN §13.5）。
--
-- 一、`sim_equity.cost`：問 AI 之前要告訴它「你手上這些股票成本多少」。
--     沒有它，模型算不出自己是賺是賠，只能瞎猜。成本在引擎裡本來就有，
--     只是沒存下來——事後回推會失真（部位是分批建的）。
--
-- 二、`sim_ai_log.overrode_stop`：AI 選擇抱過止跌價位時記一筆。
--     **不擋它**（§13.5 明訂沒有硬性停損），但要讓它自己現形——
--     抱過止跌之後發生什麼事，是回顧頁該回答的問題。
--     這個旗標不能放在 sim_trades：抱著不動根本沒有成交。
alter table sim_equity
  add column if not exists cost numeric not null default 0;

alter table sim_ai_log
  add column if not exists overrode_stop boolean not null default false;

comment on column sim_equity.cost is '當日持股的總成本（含買進手續費）';
comment on column sim_ai_log.overrode_stop is
  'AI 當天選擇不出場，但收盤已跌破止跌價位。不擋，只記分';
