Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (!(Test-Admin)) {
  $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $PSCommandPath))
  Start-Process -FilePath 'powershell.exe' -ArgumentList ($args -join ' ') -Verb RunAs -Wait
  exit $LASTEXITCODE
}

$Base = Join-Path $env:ProgramData 'HighGAS'
$TaskName = 'HighGAS Helper'

if (Test-Path (Join-Path $Base 'highgas-tor.ps1')) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Base 'highgas-tor.ps1') -Action down *> $null
}
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
Get-Process highgas-helper,tun2socks,tor -ErrorAction SilentlyContinue | Where-Object { !$_.Path -or $_.Path -like "$Base*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-NetFirewallRule -Group 'HighGAS Full Tunnel' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Base -Recurse -Force -ErrorAction SilentlyContinue
$desktop = [Environment]::GetFolderPath('Desktop')
Remove-Item -LiteralPath (Join-Path $desktop 'HighGAS.url') -Force -ErrorAction SilentlyContinue
Write-Host 'HighGAS removido e configurações de rede restauradas.' -ForegroundColor Green
