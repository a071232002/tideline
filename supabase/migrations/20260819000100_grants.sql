-- 表格層權限。RLS 決定「哪幾列」，GRANT 決定「這個角色能不能碰這張表」，
-- 兩個都要給，少一個就是 42501 permission denied。

grant usage on schema public to authenticated, service_role;

-- service_role 是寫入端（排程、管線），它繞過 RLS，所以權限給滿
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- 登入者：全站共用的資料唯讀，觀察清單可讀寫（實際能碰哪幾列由 RLS 決定）
grant select on
  symbols, daily_bars, daily_analysis, daily_commentary,
  symbol_profile, market_context, job_runs
  to authenticated;
grant select, insert, update, delete on watchlist to authenticated;

-- 之後新增的表也照這個規矩
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
