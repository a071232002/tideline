# Tideline 每日排程。由 Windows 工作排程器呼叫。
#
# 為什麼不是直接跑 npm：本機 Supabase 跑在 podman 上，而 podman machine
# 開機不會自動啟動。少了這段，重開機後排程會安靜地失敗——你隔天只會看到
# 「資料未更新」，卻不知道是因為容器沒起來。
#
# 這個檔存成 UTF-8 with BOM。PowerShell 5.1 沒有 BOM 會當成 ANSI 讀，中文變亂碼。
#
# ## 兩種模式
#
# 全本機（現在）：
#     daily.ps1
#     抓取 + AI 都在這裡跑，資料庫是 podman 上的 Supabase。
#
# 雲端（部署後）：
#     daily.ps1 -EnvFile .env.cloud -SkipIngest
#     抓取由 Vercel Cron 做，這台機器**只跑 AI**——因為 ai-decide 要
#     spawn 本機的 `claude` 二進位，那是整條線上唯一上不了雲的東西。
#
# **`-EnvFile` 一定要分開。** `.env.local` 指向本機 Supabase，而開發、
# 單元測試、E2E 全部讀它。要是把它改成指向雲端，E2E 下一次執行就會
# 直接對正式資料庫跑——那正是這個專案一直想避免的事。

param(
  # 讀哪一份環境變數。雲端 AI runner 用 .env.cloud，兩份都不進版。
  [string]$EnvFile = '.env.local',
  # 抓取交給 Vercel Cron 的時候加這個。同一份資料被兩邊各抓一次沒有好處，
  # 而且兩邊會同時重建模擬帳戶。
  [switch]$SkipIngest
)

$ErrorActionPreference = 'Stop'

# npm 的輸出是 UTF-8，但 PowerShell 5.1 預設用主控台字碼頁去讀，中文會變亂碼。
# 這兩行要在任何子程序之前。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$proj = 'C:\workspace_spec\tideline'
$log  = Join-Path $proj 'logs\ingest.log'
$env:DOCKER_HOST = 'npipe:////./pipe/podman-machine-default'

New-Item -ItemType Directory -Force -Path (Join-Path $proj 'logs') | Out-Null
Set-Location $proj

function Write-Log($msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

function Test-Supabase {
  # 位址從環境變數來，不要寫死 127.0.0.1——雲端模式要檢查的是雲端那台。
  #
  # **一定要帶 apikey。** 本機的 Supabase 這支端點不需要憑證，雲端的需要，
  # 沒帶就回 401——而 401 跟「連不上」在這裡長得一樣。實測第一次切到雲端
  # 模式就卡在這裡：Supabase 明明活著，腳本卻說「連不上，這次跳過」。
  if (-not $env:NEXT_PUBLIC_SUPABASE_URL) { return $false }
  $headers = @{}
  if ($env:NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    $headers['apikey'] = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
  try {
    $r = Invoke-WebRequest -Uri ($env:NEXT_PUBLIC_SUPABASE_URL.TrimEnd('/') + '/auth/v1/health') `
      -Headers $headers -TimeoutSec 10 -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch { return $false }
}

Write-Log ('--- 開始（' + $EnvFile + (& { if ($SkipIngest) { '，只跑 AI' } else { '' } }) + '） ---')

# 1. 讀環境變數。要在檢查 Supabase 之前——健康檢查的位址就從這裡來。
$envPath = Join-Path $proj $EnvFile
if (-not (Test-Path $envPath)) {
  Write-Log "X 找不到 $EnvFile，這次跳過"
  exit 1
}
# **-Encoding UTF8 不能省。**
#
# PowerShell 5.1 的 Get-Content 預設用主控台字碼頁（這台機器是 cp950）讀檔。
# .env 檔裡的中文註解是 UTF-8，用 cp950 解讀時一個中文字的位元組會「吃掉」
# 後面的換行，於是兩行併成一行——實測 .env.cloud 有 19 行，不指定編碼只讀到
# 14 行，而 SUPABASE_SERVICE_ROLE_KEY 剛好被併進它上面那句中文註解裡。
#
# 結果是 npm 子行程拿不到那把 key，AI 那步倒在「缺少 SUPABASE_SERVICE_ROLE_KEY」，
# 而前面的 URL 與 anon key 都讀到了——看起來像 key 填錯，其實是檔案讀錯。
Get-Content $envPath -Encoding UTF8 | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    Set-Item -Path ('env:' + $matches[1]) -Value $matches[2].Trim()
  }
}

$isLocalDb = $env:NEXT_PUBLIC_SUPABASE_URL -match '127\.0\.0\.1|localhost'

# 2. 確保 Supabase 活著。本機的話還可以自己叫醒它；雲端的話只能回報。
if (-not (Test-Supabase)) {
  if (-not $isLocalDb) {
    Write-Log 'X 連不上雲端 Supabase，這次跳過。'
    exit 1
  }
  Write-Log 'Supabase 沒有回應，嘗試啟動 podman machine'
  try { podman machine start 2>&1 | Out-Null } catch { Write-Log "podman machine start: $_" }

  # 容器是 unless-stopped，machine 起來之後會自己回來，給它時間
  $ok = $false
  foreach ($i in 1..24) {
    Start-Sleep -Seconds 5
    if (Test-Supabase) { $ok = $true; break }
  }
  if (-not $ok) {
    Write-Log '仍然連不上，嘗試 supabase start'
    try { npx supabase start 2>&1 | Out-Null } catch { Write-Log "supabase start: $_" }
    foreach ($i in 1..12) {
      Start-Sleep -Seconds 5
      if (Test-Supabase) { $ok = $true; break }
    }
  }
  if (-not $ok) {
    Write-Log 'X Supabase 起不來，這次跳過。頁面會顯示資料未更新。'
    exit 1
  }
  Write-Log 'Supabase 已就緒'
}

# 3. 抓取。雲端模式跳過——那是 Vercel Cron 的工作。
$code = 0
if ($SkipIngest) {
  Write-Log '略過抓取（由 Vercel Cron 負責）'
} else {
  $out = & npm run ingest 2>&1
  $code = $LASTEXITCODE
  $out | ForEach-Object { Write-Log $_ }
}

# 4. AI 帳戶的每日決策（PLAN §13.5）。
#
# **這一段失敗不影響上面。** 價位、指標、圖表、規則帳戶都不依賴它；
# 它掛掉隔天頁面照常，只是 AI 那條曲線多一天沒跑到。所以先判斷抓取成功、
# 再跑 AI，而且它的結果不改變這支腳本的離開碼。
if ($code -eq 0) {
  Write-Log (& { if ($SkipIngest) { '--- 開始 AI 決策 ---' }
                 else { '--- 抓取完成，開始 AI 決策 ---' } })
  try {
    $ai = & npm run ai 2>&1
    $ai | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { Write-Log "AI 決策 exit $LASTEXITCODE（不影響抓取結果）" }
  } catch {
    Write-Log "AI 決策失敗：$_（不影響抓取結果）"
  }
}

# 5. 每天問一次「全世界有什麼值得看一眼」（發現層）。
#
# 跟 AI 決策一樣：**失敗不影響上面**。它掛掉頁面照常，只是那一區停在昨天，
# 而畫面上印著日期，看得出來新不新。
#
# 排在最後是因為它最慢（要上網搜尋，再對每一檔候選抓一次完整歷史算指標），
# 而且它是唯一「今天沒有也無所謂」的一段。
if ($code -eq 0) {
  Write-Log '--- 開始挑選值得看一眼的標的 ---'
  try {
    $rec = & npm run recommend 2>&1
    $rec | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { Write-Log "推薦 exit $LASTEXITCODE（不影響抓取結果）" }
  } catch {
    Write-Log "推薦失敗：$_（不影響抓取結果）"
  }
}

if ($code -eq 0) { Write-Log '--- 完成 ---' } else { Write-Log "--- 失敗（exit $code）---" }
exit $code
