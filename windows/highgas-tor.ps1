param(
  [Parameter(Position=0)][ValidateSet('connect','disconnect','status','status-json','recover','self-test')][string]$Command = 'status',
  [Parameter(Position=1)][string]$Server = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Base = Join-Path $env:ProgramData 'HighGAS'
$Runtime = Join-Path $Base 'runtime'
$TorDir = Join-Path $Base 'tor-expert\tor'
$TorDataDir = Join-Path $Base 'tor-expert\data'
$TorExe = Join-Path $TorDir 'tor.exe'
$SingBoxExe = Join-Path $Base 'sing-box\sing-box.exe'
$Torrc = Join-Path $Runtime 'torrc'
$TorLog = Join-Path $Runtime 'tor.log'
$TorPid = Join-Path $Runtime 'tor.pid'
$SingPid = Join-Path $Runtime 'singbox.pid'
$SingConfig = Join-Path $Runtime 'sing-box.json'
$StateFile = Join-Path $Runtime 'state.json'
$CheckUrl = 'https://lowgas.vercel.app/api/network-info'
$SocksPort = 39050
$DnsPort = 39053

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'HighGAS requires an elevated Administrator shell.'
  }
}

function Ensure-Runtime {
  New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Runtime 'tor-data') | Out-Null
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Read-Pid([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  try { return [int](Get-Content -Raw $Path).Trim() } catch { return $null }
}

function Stop-TrackedProcess([string]$Path, [string]$Name) {
  $pidValue = Read-Pid $Path
  if ($pidValue) {
    try { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue } catch {}
  }
  Get-Process -Name $Name -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Remove-Item -Force $Path -ErrorAction SilentlyContinue
}

function Get-Target([string]$Code) {
  switch ($Code.ToLowerInvariant()) {
    'de-fra-01' { return @{ country='DE'; exit='{de}' } }
    'us-mia-01' { return @{ country='US'; exit='{us}' } }
    default { throw "Unsupported server: $Code" }
  }
}

function Invoke-NetworkInfo([switch]$ThroughTor) {
  $args = @('-fsS','--connect-timeout','12','--max-time','25','-H','Cache-Control: no-cache')
  if ($ThroughTor) { $args += @('--socks5-hostname',"127.0.0.1:$SocksPort") }
  $args += "${CheckUrl}?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $raw = & curl.exe @args 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw 'network_info_failed' }
  return ($raw | Out-String | ConvertFrom-Json)
}

function Write-TorConfig([hashtable]$Target) {
  $dataDir = (Join-Path $Runtime 'tor-data').Replace('\','/')
  $geo = (Join-Path $TorDataDir 'geoip').Replace('\','/')
  $geo6 = (Join-Path $TorDataDir 'geoip6').Replace('\','/')
  $log = $TorLog.Replace('\','/')
  $text = @"
ClientOnly 1
AvoidDiskWrites 1
SocksPort 127.0.0.1:$SocksPort
DNSPort 127.0.0.1:$DnsPort
DataDirectory $dataDir
GeoIPFile $geo
GeoIPv6File $geo6
ExitNodes $($Target.exit)
StrictNodes 1
Log notice file $log
"@
  Set-Content -Path $Torrc -Value $text -Encoding Ascii
}

function Wait-TorBootstrap {
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path $TorLog) {
      $tail = Get-Content $TorLog -Tail 80 -ErrorAction SilentlyContinue | Out-String
      if ($tail -match 'Bootstrapped 100%') { return }
      if ($tail -match '\[err\]|Unable to start Tor|Failed to parse') { throw "Tor bootstrap failed: $tail" }
    }
    $pidValue = Read-Pid $TorPid
    if ($pidValue -and -not (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { throw 'Tor exited during bootstrap.' }
    Start-Sleep -Seconds 2
  }
  throw 'Tor bootstrap timeout.'
}

function Write-SingBoxConfig {
  $config = @'
{
  "log": { "level": "info", "timestamp": true },
  "dns": {
    "servers": [
      { "type": "udp", "tag": "tor-dns", "server": "127.0.0.1", "server_port": 39053, "detour": "direct" }
    ],
    "final": "tor-dns",
    "strategy": "ipv4_only",
    "timeout": "10s"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "highgas-tun",
      "interface_name": "HighGAS",
      "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
      "mtu": 1500,
      "auto_route": true,
      "strict_route": true,
      "stack": "system"
    }
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
    { "type": "socks", "tag": "tor-socks", "server": "127.0.0.1", "server_port": 39050, "version": "5", "network": "tcp" }
  ],
  "route": {
    "auto_detect_interface": true,
    "rules": [
      { "protocol": "dns", "action": "hijack-dns" },
      { "process_name": ["tor.exe"], "action": "route", "outbound": "direct" },
      { "ip_version": 6, "action": "reject" },
      { "network": "udp", "action": "reject" }
    ],
    "final": "tor-socks"
  }
}
'@
  Write-Utf8NoBom $SingConfig $config
}

function Assert-SingBoxConfig {
  & $SingBoxExe check -c $SingConfig
  if ($LASTEXITCODE -ne 0) { throw 'sing-box config validation failed.' }
}

function Start-Tracked([string]$File, [string[]]$Args, [string]$PidPath, [string]$Stdout, [string]$Stderr) {
  $p = Start-Process -FilePath $File -ArgumentList $Args -WindowStyle Hidden -PassThru -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
  Set-Content -Path $PidPath -Value $p.Id -Encoding Ascii
  return $p
}

function Test-IPv6Blocked {
  & curl.exe -6 -fsS --connect-timeout 4 --max-time 7 'https://api64.ipify.org' *> $null
  return ($LASTEXITCODE -ne 0)
}

function Save-State([string]$Server,[string]$Country,[string]$Ip,[hashtable]$Checks) {
  $state = [ordered]@{ connected=$true; country=$Country; server=$Server; started=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); ip=$Ip; checks=$Checks }
  Write-Utf8NoBom $StateFile ($state | ConvertTo-Json -Depth 5)
}

function Read-State {
  if (-not (Test-Path $StateFile)) { return $null }
  try { return (Get-Content -Raw $StateFile | ConvertFrom-Json) } catch { return $null }
}

function Disconnect-HighGAS {
  Stop-TrackedProcess $SingPid 'sing-box'
  Start-Sleep -Milliseconds 500
  Stop-TrackedProcess $TorPid 'tor'
  Remove-Item -Force $StateFile,$SingConfig,$Torrc -ErrorAction SilentlyContinue
  Clear-DnsClientCache -ErrorAction SilentlyContinue
}

function Recover-HighGAS {
  Disconnect-HighGAS
}

function Connect-HighGAS([string]$Code) {
  Assert-Admin
  Ensure-Runtime
  if (-not (Test-Path $TorExe)) { throw "Tor not found: $TorExe" }
  if (-not (Test-Path $SingBoxExe)) { throw "sing-box not found: $SingBoxExe" }
  if (-not (Test-Path (Join-Path $TorDataDir 'geoip'))) { throw 'Tor geoip data missing.' }
  if (-not (Test-Path (Join-Path $TorDataDir 'geoip6'))) { throw 'Tor geoip6 data missing.' }
  $target = Get-Target $Code
  Recover-HighGAS
  $baseline = Invoke-NetworkInfo

  Remove-Item -Force $TorLog -ErrorAction SilentlyContinue
  Write-TorConfig $target
  $torOut = Join-Path $Runtime 'tor.stdout.log'
  $torErr = Join-Path $Runtime 'tor.stderr.log'
  $tor = Start-Tracked $TorExe @('-f',$Torrc) $TorPid $torOut $torErr
  Wait-TorBootstrap

  $torInfo = Invoke-NetworkInfo -ThroughTor
  if (([string]$torInfo.country).ToUpperInvariant() -ne $target.country) {
    throw "Tor exit country mismatch. expected=$($target.country) got=$($torInfo.country)"
  }
  if ($baseline.ip -and $torInfo.ip -and $baseline.ip -eq $torInfo.ip) { throw 'Tor did not change public IP.' }

  Write-SingBoxConfig
  Assert-SingBoxConfig
  $singOut = Join-Path $Runtime 'singbox.stdout.log'
  $singErr = Join-Path $Runtime 'singbox.stderr.log'
  $sing = Start-Tracked $SingBoxExe @('run','-c',$SingConfig) $SingPid $singOut $singErr
  Start-Sleep -Seconds 5
  if ($sing.HasExited) { throw "sing-box exited: $(Get-Content $singErr -Tail 100 -ErrorAction SilentlyContinue | Out-String)" }

  $systemInfo = Invoke-NetworkInfo
  $countryOk = (([string]$systemInfo.country).ToUpperInvariant() -eq $target.country)
  $ipChanged = ($systemInfo.ip -and $baseline.ip -and $systemInfo.ip -ne $baseline.ip)
  $torMatch = ($systemInfo.ip -and $torInfo.ip -and $systemInfo.ip -eq $torInfo.ip)
  $ipv6Blocked = Test-IPv6Blocked
  $adapter = [bool](Get-NetAdapter -Name 'HighGAS' -ErrorAction SilentlyContinue)
  $singAlive = -not $sing.HasExited
  $torAlive = -not $tor.HasExited
  $checks = [ordered]@{
    ip_changed = [bool]$ipChanged
    country = [bool]$countryOk
    tor_ip_match = [bool]$torMatch
    ipv6_blocked = [bool]$ipv6Blocked
    tun_adapter = [bool]$adapter
    singbox_alive = [bool]$singAlive
    tor_alive = [bool]$torAlive
  }
  $failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
  if ($failed.Count -gt 0) { throw "Full-tunnel verification failed: $($failed.Name -join ', ')" }
  Save-State $Code $target.country ([string]$systemInfo.ip) $checks
  [ordered]@{ok=$true;server=$Code;country=$target.country;ip=$systemInfo.ip;checks=$checks} | ConvertTo-Json -Depth 5 -Compress
}

function Status-Json {
  $state = Read-State
  $singPidValue = Read-Pid $SingPid
  $torPidValue = Read-Pid $TorPid
  $singAlive = $singPidValue -and (Get-Process -Id $singPidValue -ErrorAction SilentlyContinue)
  $torAlive = $torPidValue -and (Get-Process -Id $torPidValue -ErrorAction SilentlyContinue)
  if ($state -and $singAlive -and $torAlive) {
    [ordered]@{connected=$true;country=$state.country;server=$state.server;started=[int64]$state.started;checks=$state.checks} | ConvertTo-Json -Depth 5 -Compress
  } else {
    [ordered]@{connected=$false;country='';server='';started=0;checks=@{}} | ConvertTo-Json -Compress
  }
}

function Self-Test {
  Assert-Admin
  Ensure-Runtime
  if (-not (Test-Path $TorExe)) { throw 'tor_missing' }
  if (-not (Test-Path $SingBoxExe)) { throw 'singbox_missing' }
  if (-not (Test-Path (Join-Path $TorDataDir 'geoip'))) { throw 'tor_geoip_missing' }
  if (-not (Test-Path (Join-Path $TorDataDir 'geoip6'))) { throw 'tor_geoip6_missing' }
  Write-SingBoxConfig
  Assert-SingBoxConfig
  $v = & $SingBoxExe version | Out-String
  [ordered]@{ok=$true;platform='windows';singbox=($v.Trim() -split "`n")[0];tor=(& $TorExe --version | Select-Object -First 1)} | ConvertTo-Json -Compress
}

try {
  switch ($Command) {
    'connect' { Connect-HighGAS $Server }
    'disconnect' { Assert-Admin; Disconnect-HighGAS; '{"ok":true}' }
    'recover' { Assert-Admin; Recover-HighGAS; '{"ok":true}' }
    'status-json' { Status-Json }
    'status' {
      $s = Read-State
      if ($s) { "connected tor $($s.country) $($s.server) $($s.started)" } else { 'disconnected' }
    }
    'self-test' { Self-Test }
  }
} catch {
  if ($Command -eq 'connect') { try { Recover-HighGAS } catch {} }
  Write-Error $_
  exit 1
}
