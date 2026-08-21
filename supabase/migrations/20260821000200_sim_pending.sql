-- 「明天開盤將執行」（PLAN §13.1 一）。
--
-- 最後一天的訊號還沒成交——那不是缺陷，那是整張帳戶卡最重要的一行：
-- 一句可以在真實世界照做的指令（「明天開盤買進 33 股」）。
-- 它由重建時算出來，存在帳戶上，頁面不必為了顯示一行字重跑整段模擬。
alter table sim_accounts
  add column if not exists pending jsonb;

comment on column sim_accounts.pending is
  '最新一天產生但尚未成交的訊號：{ signalD, side, triggers }。null=明天不動作';
