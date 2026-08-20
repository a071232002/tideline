# Tideline 每日抓取。由 Windows 工作排程器呼叫。
#
# 為什麼不是直接跑 npm：本機 Supabase 跑在 podman 上，而 podman machine
# 開機不會自動啟動。少了這段，重開機後排程會安靜地失敗——你隔天只會看到
# 「資料未更新」，卻不知道是因為容器沒起來。
#
# 這個檔存成 UTF-8 with BOM。PowerShell 5.1 沒有 BOM 會當成 ANSI 讀，中文變亂碼。

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
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:54421/auth/v1/health' -TimeoutSec 5 -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch { return $false }
}

Write-Log '--- 開始 ---'

# 1. 確保 Supabase 起得來
if (-not (Test-Supabase)) {
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

# 2. 讀 .env.local（service role key 不進版，只在這台機器上）
Get-Content (Join-Path $proj '.env.local') | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    Set-Item -Path ('env:' + $matches[1]) -Value $matches[2].Trim()
  }
}

# 3. 抓取
$out = & npm run ingest 2>&1
$code = $LASTEXITCODE
$out | ForEach-Object { Write-Log $_ }

if ($code -eq 0) { Write-Log '--- 完成 ---' } else { Write-Log "--- 失敗（exit $code）---" }
exit $code
