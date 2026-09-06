# 一键启动：端口占用则直接打开浏览器，否则启动服务后再打开。
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Find-NodeDir {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return Split-Path $cmd.Source }

  $candidates = @(
    "C:\Program Files\nodejs",
    "C:\Program Files (x86)\nodejs"
  )
  Get-ChildItem "F:\" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $candidates += $_.FullName
    $candidates += (Join-Path $_.FullName "nodejs")
  }
  foreach ($dir in $candidates) {
    if (Test-Path (Join-Path $dir "node.exe")) { return $dir }
  }
  return $null
}

function Test-PortOpen([int]$Port) {
  try {
    $r = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$r
  } catch {
    $out = netstat -ano | Select-String ":$Port\s+.*LISTENING"
    return [bool]$out
  }
}

$nodeDir = Find-NodeDir
if (-not $nodeDir) {
  Write-Host "找不到 Node.js。请安装 Node.js 20+ 后再双击启动。"
  Read-Host "按回车退出"
  exit 1
}
$env:Path = "$nodeDir;$env:Path"

if (-not (Test-Path ".\node_modules")) {
  Write-Host "首次运行，正在安装依赖…"
  & (Join-Path $nodeDir "npm.cmd") install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$url = "http://localhost:$port/"

if (-not (Test-PortOpen $port)) {
  Write-Host "正在启动 NewsNow Bold…"
  Start-Process -FilePath (Join-Path $nodeDir "node.exe") -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 400
    if (Test-PortOpen $port) { $ok = $true; break }
  }
  if (-not $ok) {
    Write-Host "服务启动超时。请在本目录运行 npm start 查看报错。"
    Read-Host "按回车退出"
    exit 1
  }
}

Start-Process $url
Write-Host "已打开 $url"
Start-Sleep -Seconds 1
