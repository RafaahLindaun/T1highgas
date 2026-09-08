$ErrorActionPreference = 'SilentlyContinue'
$Base = Join-Path $env:ProgramData 'HighGAS'
$Task = 'HighGAS-Helper'
$Cert = Join-Path $Base 'certs\server.crt'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Execute DESINSTALAR-HIGHGAS-WINDOWS.cmd; ele solicitara permissao de Administrador automaticamente.'
  exit 1
}

if (Test-Path (Join-Path $Base 'highgas-tor.ps1')) { & (Join-Path $Base 'highgas-tor.ps1') disconnect *> $null }
schtasks.exe /End /TN $Task *> $null
schtasks.exe /Delete /TN $Task /F *> $null
Get-Process highgas-helper,sing-box,tor -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $Cert) { certutil.exe -delstore Root "HighGAS Local Helper" *> $null }

$shortcuts = @()
if ($env:USERPROFILE) { $shortcuts += (Join-Path $env:USERPROFILE 'Desktop\HighGAS.url') }
if ($env:PUBLIC) { $shortcuts += (Join-Path $env:PUBLIC 'Desktop\HighGAS.url') }
foreach ($shortcut in ($shortcuts | Select-Object -Unique)) { Remove-Item -Force $shortcut -ErrorAction SilentlyContinue }

Remove-Item -Recurse -Force $Base -ErrorAction SilentlyContinue
Clear-DnsClientCache -ErrorAction SilentlyContinue
Write-Host 'HighGAS removido do Windows.' -ForegroundColor Green
