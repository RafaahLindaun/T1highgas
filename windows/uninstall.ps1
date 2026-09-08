$ErrorActionPreference = 'SilentlyContinue'
$Base = Join-Path $env:ProgramData 'HighGAS'
$Task = 'HighGAS-Helper'
$Cert = Join-Path $Base 'certs\server.crt'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Execute UNINSTALL-HIGHGAS-WINDOWS.cmd como Administrador.'
  exit 1
}

if (Test-Path (Join-Path $Base 'highgas-tor.ps1')) { & (Join-Path $Base 'highgas-tor.ps1') disconnect *> $null }
schtasks.exe /End /TN $Task *> $null
schtasks.exe /Delete /TN $Task /F *> $null
Get-Process highgas-helper,sing-box,tor -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $Cert) { certutil.exe -delstore Root "HighGAS Local Helper" *> $null }
Remove-Item -Recurse -Force $Base
Clear-DnsClientCache -ErrorAction SilentlyContinue
Write-Host 'HighGAS removido do Windows.' -ForegroundColor Green
