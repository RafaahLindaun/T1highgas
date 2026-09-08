param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Execute INSTALAR-HIGHGAS-WINDOWS.cmd; ele solicitara permissao de Administrador automaticamente.'
  }
}

Assert-Admin
$Package = Split-Path -Parent $MyInvocation.MyCommand.Path
$Payload = Join-Path $Package 'payload'
$Base = Join-Path $env:ProgramData 'HighGAS'
$Task = 'HighGAS-Helper'
$Helper = Join-Path $Base 'highgas-helper.exe'
$Cert = Join-Path $Base 'certs\server.crt'
$LocalUrl = 'https://127.0.0.1:37654/'

if (-not (Test-Path (Join-Path $Payload 'highgas-helper.exe'))) { throw 'Pacote HighGAS incompleto: helper ausente.' }
if (-not (Test-Path (Join-Path $Payload 'highgas-tor.ps1'))) { throw 'Pacote HighGAS incompleto: controlador Tor ausente.' }
if (-not (Test-Path (Join-Path $Payload 'tor-expert\tor\tor.exe'))) { throw 'Pacote HighGAS incompleto: Tor ausente.' }
if (-not (Test-Path (Join-Path $Payload 'tor-expert\data\geoip'))) { throw 'Pacote HighGAS incompleto: GeoIP ausente.' }
if (-not (Test-Path (Join-Path $Payload 'tor-expert\data\geoip6'))) { throw 'Pacote HighGAS incompleto: GeoIPv6 ausente.' }
if (-not (Test-Path (Join-Path $Payload 'sing-box\sing-box.exe'))) { throw 'Pacote HighGAS incompleto: sing-box ausente.' }
if (-not (Test-Path (Join-Path $Payload 'highgas-local-controller.js'))) { throw 'Pacote HighGAS incompleto: interface local ausente.' }

Write-Host 'HighGAS: preparando instalacao...' -ForegroundColor Cyan
try {
  & (Join-Path $Base 'highgas-tor.ps1') disconnect *> $null
} catch {}
try { schtasks.exe /End /TN $Task *> $null } catch {}
try { schtasks.exe /Delete /TN $Task /F *> $null } catch {}
Get-Process highgas-helper,sing-box,tor -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $Base | Out-Null
Copy-Item -Path (Join-Path $Payload '*') -Destination $Base -Recurse -Force

$controller = Join-Path $Base 'highgas-local-controller.js'
$text = Get-Content -Raw $controller
$text = $text.Replace('Protegendo o Mac', 'Protegendo o sistema').Replace('seu Mac', 'seu computador').Replace('no Mac', 'no computador')
[IO.File]::WriteAllText($controller, $text, (New-Object Text.UTF8Encoding($false)))

& $Helper --init-cert | Out-Null
if (-not (Test-Path $Cert)) { throw 'Falha ao gerar certificado local.' }
certutil.exe -addstore -f Root $Cert | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao confiar no certificado local do HighGAS.' }

& icacls.exe $Base /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

$taskCommand = '"' + $Helper + '"'
schtasks.exe /Create /TN $Task /SC ONSTART /RU SYSTEM /RL HIGHEST /TR $taskCommand /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao registrar inicializacao automatica.' }
schtasks.exe /Run /TN $Task | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar o helper do HighGAS.' }

$ready = $false
$lastError = ''
for ($i=0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-RestMethod -UseBasicParsing -Uri 'https://127.0.0.1:37654/v1/health' -TimeoutSec 3
    if ($h.ok -and $h.platform -eq 'windows' -and $h.torReady -and $h.controllerReady) { $ready = $true; break }
    $lastError = "health returned ok=$($h.ok) platform=$($h.platform) torReady=$($h.torReady) controllerReady=$($h.controllerReady)"
  } catch {
    $lastError = $_.Exception.Message
  }
  if (($i % 10) -eq 9) {
    try { schtasks.exe /Run /TN $Task *> $null } catch {}
  }
}
if (-not $ready) {
  try { schtasks.exe /End /TN $Task *> $null } catch {}
  throw "O helper local nao ficou pronto. Ultimo diagnostico: $lastError"
}

$shortcutText = "[InternetShortcut]`r`nURL=$LocalUrl`r`n"
$shortcutPaths = @()
if ($env:USERPROFILE) { $shortcutPaths += (Join-Path $env:USERPROFILE 'Desktop\HighGAS.url') }
if ($env:PUBLIC) { $shortcutPaths += (Join-Path $env:PUBLIC 'Desktop\HighGAS.url') }
foreach ($shortcut in ($shortcutPaths | Select-Object -Unique)) {
  try {
    $dir = Split-Path -Parent $shortcut
    if (Test-Path $dir) { [IO.File]::WriteAllText($shortcut, $shortcutText, [Text.Encoding]::ASCII) }
  } catch {}
}

Write-Host 'HighGAS instalado e validado no Windows.' -ForegroundColor Green
Write-Host "Interface: $LocalUrl" -ForegroundColor Green
if (-not $NoLaunch) { Start-Process $LocalUrl }
