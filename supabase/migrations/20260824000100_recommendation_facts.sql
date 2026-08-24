-- 推薦改成「題材負責發現、指標負責排序」（2026-08-24）
--
-- 原本 rank 就是模型回傳的順序，依據是它讀到的新聞熱度。問題是熱度的同義詞
-- 是「已經漲上去了」——照它排，這一區就變成轉貼新聞的區塊。
--
-- 現在題材只負責把視野推出使用者自己的清單，排序交給這個站判斷任何一檔
-- 標的時用的同一套規則（§4）：回檔到加碼區、%b 在中軌以下、KD 在低檔。
--
-- 這幾欄存的是**當天算出來的事實**，畫面要靠它說出「為什麼排這裡」。
-- 存下來而不是即時算，因為候選不在 watchlist 裡——它們的 K 棒不會被
-- 每日抓取更新，明天重算會得到不一樣的數字，那樣就沒辦法回頭檢視當天的判斷。
alter table recommendations add column if not exists score numeric;
alter table recommendations add column if not exists facts jsonb;

comment on column recommendations.score is
  '0～1，由 %b／K／離加碼區上緣的距離三項等權合成。權重是猜的，驗收場是 §11 的回顧';
comment on column recommendations.facts is
  '當天算出來的事實：close/k/d/pctB/ma60/加碼區/止跌。**這些是我們自己算的**，'
  '跟 theme 裡那些來自新聞的數字不同——後者沒有經過驗證器';
