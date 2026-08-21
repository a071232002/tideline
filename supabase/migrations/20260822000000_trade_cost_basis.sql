-- 賣出當下的每股平均成本（PLAN §13.7）。
--
-- 回顧頁要算「幾次裡幾次賺錢」，就得知道賣出時的成本基礎。
-- 事後回推都會失真：部位是分批建的，平均成本只有成交當下知道，
-- 而且賣一半之後剩下的成本基礎又變了。
--
-- 買進那幾筆是 null——它們還沒結算損益。
alter table sim_trades
  add column if not exists cost_basis numeric;

comment on column sim_trades.cost_basis is
  '賣出當下的每股平均成本；買進為 null。用來判定該筆賣出是賺是賠';
