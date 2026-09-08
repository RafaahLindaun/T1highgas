Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (!(Test-Admin)) {
  $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $PSCommandPath))
  Start-Process -FilePath 'powershell.exe' -ArgumentList ($args -join ' ') -Verb RunAs -Wait
  exit $LASTEXITCODE
}

$Source = $PSScriptRoot
$Base = Join-Path $env:ProgramData 'HighGAS'
$TaskName = 'HighGAS Helper'
$Url = 'http://127.0.0.1:37654/'

Write-Host 'Instalando HighGAS 2.0 para Windows 11...' -ForegroundColor Cyan

try {
  if (Test-Path (Join-Path $Base 'highgas-tor.ps1')) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Base 'highgas-tor.ps1') -Action down *> $null
  }
} catch {}
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
Get-Process highgas-helper -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $Base | Out-Null
$required = @('highgas-helper.exe','highgas-tor.ps1','tun2socks.exe','wintun.dll','highgas-local-controller.js')
foreach ($f in $required) {
  if (!(Test-Path (Join-Path $Source $f))) { throw "Pacote incompleto: $f ausente." }
}
if (!(Test-Path (Join-Path $Source 'tor-expert\tor\tor.exe'))) { throw 'Pacote incompleto: Tor Expert ausente.' }
if (!(Test-Path (Join-Path $Source 'tor-expert\data\geoip'))) { throw 'Pacote incompleto: GeoIP ausente.' }
if (!(Test-Path (Join-Path $Source 'tor-expert\data\geoip6'))) { throw 'Pacote incompleto: GeoIPv6 ausente.' }

Get-ChildItem -LiteralPath $Source -Force | Where-Object { $_.Name -notin @('install.bat') } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $Base -Recurse -Force
}

# Somente SYSTEM e Administradores podem ler ou alterar binários, configuração e token.
& icacls.exe $Base /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não consegui proteger os arquivos locais do HighGAS.' }

$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
$tokenPath = Join-Path $Base 'helper.token'
Set-Content -LiteralPath $tokenPath -Value $token -Encoding ASCII -NoNewline
& icacls.exe $tokenPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não consegui proteger o token local.' }

$helper = Join-Path $Base 'highgas-helper.exe'
$action = New-ScheduledTaskAction -Execute $helper -Argument ('--token-file "{0}"' -f $tokenPath) -WorkingDirectory $Base
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$ok = $false
for ($i=0;$i -lt 100;$i++) {
  Start-Sleep -Milliseconds 250
  try {
    $h = Invoke-RestMethod -UseBasicParsing -Uri ($Url + 'v1/health') -TimeoutSec 3
    if ($h.helper -and $h.version -eq '2.0.0' -and $h.platform -eq 'windows' -and $h.engineReady -and $h.controllerReady) { $ok=$true; break }
  } catch {}
}
if (!$ok) { throw 'O helper local não iniciou corretamente.' }

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop 'HighGAS.url'
@("[InternetShortcut]","URL=$Url","IconFile=$helper","IconIndex=0") | Set-Content -LiteralPath $shortcut -Encoding ASCII

Write-Host ''
Write-Host 'HighGAS 2.0 instalado com sucesso.' -ForegroundColor Green
Write-Host 'Windows 11: Full Tunnel + Tor + Kill Switch + DNS protegido.' -ForegroundColor Green
Write-Host 'Atalho HighGAS criado na Área de Trabalho.'
Write-Host "Link fixo: $Url"
Write-Host 'O HighGAS só mostra CONECTADO quando as 5 verificações passarem.'
Start-Process $Url
