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

# **不能用 Write-Output。**
#
# 它寫的是「管線」，而在函式裡呼叫的話那些行會變成**函式的回傳值**。
# Invoke-Step 因此回傳「一整包 log 文字，最後才是離開碼」，
# `(Invoke-Step …) -ne 0` 拿到的是一個陣列，永遠為真——每一步都被記成
# 「沒有成功」，即使它剛剛才成功。用 [Console] 直接寫，繞開管線。
function Write-Log($msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  [Console]::Out.WriteLine($line)
  Add-Content -Path $log -Value $line -Encoding utf8
}

<#
.SYNOPSIS
  跑一段外部指令，把輸出寫進 log，回傳它的離開碼。

.DESCRIPTION
  **不要直接寫 `& npm run x 2>&1`。**

  PowerShell 5.1 在 `2>&1` 之下會把原生指令 stderr 的每一行包成 ErrorRecord，
  而這個檔案開頭是 `$ErrorActionPreference = 'Stop'`——於是任何一行 stderr
  都會直接 throw，賦值不會發生，**真正的 stdout 整段被丟掉**。

  實測 2026-08-28 14:35：推薦其實走的是正常的早退路徑（早上已經寫過六筆，
  今天不用再問一次），只是收工時 Windows 的 libuv 吐了一行斷言。log 上留下的
  卻是「推薦失敗：Assertion failed…」，而那句「已經有 6 筆推薦，跳過」不見了。
  把成功記成失敗，還把證據刪掉。

  更危險的是同樣的寫法出現在抓取那一步，而那一步**不在 try/catch 裡**：
  npm 隨便一行 warning 就會讓整支腳本停在那裡，AI 與推薦都不會跑。

  所以這裡把 `$ErrorActionPreference` 暫時放回 'Continue'，讓 stderr 只是
  文字；成功與否一律看 `$LASTEXITCODE`，那才是唯一可信的訊號。
#>
function Invoke-Step {
  param([string]$Name, [scriptblock]$Command)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Command 2>&1
    $code = $LASTEXITCODE
  } catch {
    Write-Log ('X ' + $Name + ' 沒能啟動：' + $_)
    return 1
  } finally {
    $ErrorActionPreference = $prev
  }
  $out | ForEach-Object { Write-Log $_ }
  if ($null -eq $code) { $code = 0 }
  if ($code -ne 0) { Write-Log ('X ' + $Name + ' exit ' + $code) }
  # 這個 return 必須是這個函式**唯一**流進管線的東西
  return [int]$code
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

# 2.5 這個工作被砍掉的時間，夠不夠這一輪跑完？
#
# **這件事發生過，而且連續三天沒有人發現。** 2026-08-30、08-31、09-01 的
# 早上那輪都在等抓取的時候被工作排程器砍掉（267014 SCHED_S_TASK_TERMINATED）：
# log 裡只有一行「開始 AI 決策」，沒有錯誤、沒有結束。原因是 ai-decide 最多
# 等 45 分鐘（INGEST_WAIT_MS），而兩個工作的 ExecutionTimeLimit 是 PT30M。
#
# Invoke-Step 會把子行程的輸出收集起來、等它結束才寫進 log——所以行程被砍
# 的時候，那些輸出**一起消失**。沉默看起來跟正常一模一樣。
#
# 這一段在開跑前就把話說出口。它不能阻止被砍，但至少下一次 log 裡會有一行
# 寫著「這一輪很可能跑不完」，而不是一片空白。
$needMin = 65   # INGEST_WAIT_MS 45 分 + 實際工作 20 分（見 src/lib/schedule.ts）
try {
  $mine = Get-ScheduledTask -ErrorAction Stop | Where-Object {
    $_.Actions.Arguments -match 'daily\.ps1'
  }
  foreach ($t in $mine) {
    $lim = $t.Settings.ExecutionTimeLimit
    if ([string]::IsNullOrEmpty($lim) -or $lim -eq 'PT0S') { continue }
    $mins = [System.Xml.XmlConvert]::ToTimeSpan($lim).TotalMinutes
    if ($mins -lt $needMin) {
      Write-Log ('X 排程「{0}」的執行時間上限只有 {1} 分鐘，這一輪最多需要 {2} 分鐘' -f $t.TaskName, [int]$mins, $needMin)
      Write-Log '  等抓取的時候會被砍掉，而且 log 不會留下任何痕跡。修法（PowerShell）：'
      Write-Log ('  $x = Get-ScheduledTask -TaskName ''{0}''' -f $t.TaskName)
      Write-Log '  $x.Settings.ExecutionTimeLimit = ''PT90M'''
      Write-Log ('  Set-ScheduledTask -TaskName ''{0}'' -Settings $x.Settings' -f $t.TaskName)
    }
  }
} catch {
  # 查不到就算了——手動跑這支腳本時本來就沒有排程器
}

# 3. 抓取。雲端模式跳過——那是 Vercel Cron 的工作。
$code = 0
if ($SkipIngest) {
  Write-Log '略過抓取（由 Vercel Cron 負責）'
} else {
  $code = Invoke-Step '抓取' { npm run ingest }
}

# 4. AI 帳戶的每日決策（PLAN §13.5）。
#
# **這一段失敗不影響上面。** 價位、指標、圖表、規則帳戶都不依賴它；
# 它掛掉隔天頁面照常，只是 AI 那條曲線多一天沒跑到。所以先判斷抓取成功、
# 再跑 AI，而且它的結果不改變這支腳本的離開碼。
if ($code -eq 0) {
  Write-Log (& { if ($SkipIngest) { '--- 開始 AI 決策 ---' }
                 else { '--- 抓取完成，開始 AI 決策 ---' } })
  if ((Invoke-Step 'AI 決策' { npm run ai }) -ne 0) {
    Write-Log 'AI 決策沒有成功（不影響抓取結果）'
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
  if ((Invoke-Step '推薦' { npm run recommend }) -ne 0) {
    Write-Log '推薦沒有成功（不影響抓取結果）'
  }
}

if ($code -eq 0) { Write-Log '--- 完成 ---' } else { Write-Log "--- 失敗（exit $code）---" }
exit $code
