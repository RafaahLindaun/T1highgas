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
$StageLog = Join-Path $Runtime 'connect-stage.log'
$CiBypassFlag = Join-Path $Base 'ci-runner-bypass.flag'
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

function Write-Stage([string]$Name) {
  try {
    Ensure-Runtime
    Add-Content -Path $StageLog -Value ("{0:o} {1}" -f [DateTime]::UtcNow,$Name) -Encoding utf8
  } catch {}
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
    try {
      $exePath = $_.Path
      if ($exePath -and $exePath.StartsWith($Base, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
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
  $curlArgs = @('-fsS','--connect-timeout','12','--max-time','25','-H','Cache-Control: no-cache')
  if ($ThroughTor) { $curlArgs += @('--socks5-hostname',"127.0.0.1:$SocksPort") }
  $curlArgs += "${CheckUrl}?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $oldErrorActionPreference = $ErrorActionPreference
  $hasNativePreference = Test-Path variable:PSNativeCommandUseErrorActionPreference
  if ($hasNativePreference) { $oldNativePreference = $PSNativeCommandUseErrorActionPreference }
  try {
    $ErrorActionPreference = 'Continue'
    if ($hasNativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
    $raw = & curl.exe @curlArgs 2>$null
    $curlExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldErrorActionPreference
    if ($hasNativePreference) { $PSNativeCommandUseErrorActionPreference = $oldNativePreference }
  }
  if ($curlExit -ne 0 -or -not $raw) { throw "network_info_failed exit=$curlExit" }
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
  $rules = @()
  if (Test-Path $CiBypassFlag) {
    $rules += [ordered]@{
      process_name = @('Runner.Listener.exe','Runner.Listener','Runner.Worker.exe','Runner.Worker','hosted-compute-agent.exe','hosted-compute-agent','provjobd.exe','provjobd')
      action = 'route'
      outbound = 'direct'
    }
  }
  $rules += [ordered]@{ protocol = 'dns'; action = 'hijack-dns' }
  $rules += [ordered]@{ process_name = @('tor.exe'); action = 'route'; outbound = 'direct' }
  $rules += [ordered]@{ ip_version = 6; action = 'reject' }
  $rules += [ordered]@{ network = @('udp'); action = 'reject' }

  $config = [ordered]@{
    log = [ordered]@{ level = 'info'; timestamp = $true }
    dns = [ordered]@{
      servers = @([ordered]@{ type='udp'; tag='tor-dns'; server='127.0.0.1'; server_port=39053 })
      final = 'tor-dns'
      strategy = 'ipv4_only'
      timeout = '10s'
    }
    inbounds = @([ordered]@{
      type = 'tun'
      tag = 'highgas-tun'
      interface_name = 'HighGAS'
      address = @('172.19.0.1/30','fdfe:dcba:9876::1/126')
      mtu = 1500
      auto_route = $true
      strict_route = $true
      stack = 'system'
    })
    outbounds = @(
      [ordered]@{ type='direct'; tag='direct' },
      [ordered]@{ type='socks'; tag='tor-socks'; server='127.0.0.1'; server_port=39050; version='5'; network='tcp' }
    )
    route = [ordered]@{
      auto_detect_interface = $true
      rules = $rules
      final = 'tor-socks'
    }
  }
  Write-Utf8NoBom $SingConfig ($config | ConvertTo-Json -Depth 12)
}

function Assert-SingBoxConfig {
  & $SingBoxExe check -c $SingConfig
  if ($LASTEXITCODE -ne 0) { throw 'sing-box config validation failed.' }
}

function Start-Tracked {
  param(
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][string[]]$ProcessArgs,
    [Parameter(Mandatory=$true)][string]$PidPath,
    [Parameter(Mandatory=$true)][string]$Stdout,
    [Parameter(Mandatory=$true)][string]$Stderr
  )
  if (-not $ProcessArgs -or $ProcessArgs.Count -eq 0) { throw "No process arguments supplied for $File" }
  $p = Start-Process -FilePath $File -ArgumentList $ProcessArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
  Set-Content -Path $PidPath -Value $p.Id -Encoding Ascii
  return $p
}

function Test-IPv6Blocked {
  $oldErrorActionPreference = $ErrorActionPreference
  $hasNativePreference = Test-Path variable:PSNativeCommandUseErrorActionPreference
  if ($hasNativePreference) { $oldNativePreference = $PSNativeCommandUseErrorActionPreference }
  try {
    $ErrorActionPreference = 'Continue'
    if ($hasNativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
    & curl.exe -6 -fsS --connect-timeout 4 --max-time 7 'https://api64.ipify.org' *> $null
    $probeExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldErrorActionPreference
    if ($hasNativePreference) { $PSNativeCommandUseErrorActionPreference = $oldNativePreference }
  }
  return ($probeExit -ne 0)
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
  Remove-Item -Force $StageLog -ErrorAction SilentlyContinue
  Write-Stage 'begin'
  if (-not (Test-Path $TorExe)) { throw "Tor not found: $TorExe" }
  if (-not (Test-Path $SingBoxExe)) { throw "sing-box not found: $SingBoxExe" }
  if (-not (Test-Path (Join-Path $TorDataDir 'geoip'))) { throw 'Tor geoip data missing.' }
  if (-not (Test-Path (Join-Path $TorDataDir 'geoip6'))) { throw 'Tor geoip6 data missing.' }
  $target = Get-Target $Code

  Write-Stage 'recover:start'
  Recover-HighGAS
  Write-Stage 'recover:done'

  Write-Stage 'baseline:start'
  $baseline = Invoke-NetworkInfo
  Write-Stage "baseline:done country=$($baseline.country) ip=$($baseline.ip)"

  Remove-Item -Force $TorLog -ErrorAction SilentlyContinue
  Write-TorConfig $target
  $torOut = Join-Path $Runtime 'tor.stdout.log'
  $torErr = Join-Path $Runtime 'tor.stderr.log'
  Write-Stage 'tor:start'
  $tor = Start-Tracked -File $TorExe -ProcessArgs @('-f',$Torrc) -PidPath $TorPid -Stdout $torOut -Stderr $torErr
  Wait-TorBootstrap
  Write-Stage 'tor:bootstrapped'

  Write-Stage 'tor-verify:start'
  $torInfo = Invoke-NetworkInfo -ThroughTor
  if (([string]$torInfo.country).ToUpperInvariant() -ne $target.country) {
    throw "Tor exit country mismatch. expected=$($target.country) got=$($torInfo.country)"
  }
  if ($baseline.ip -and $torInfo.ip -and $baseline.ip -eq $torInfo.ip) { throw 'Tor did not change public IP.' }
  Write-Stage "tor-verify:done country=$($torInfo.country) ip=$($torInfo.ip)"

  Write-Stage 'sing-config:start'
  Write-SingBoxConfig
  Assert-SingBoxConfig
  Write-Stage 'sing-config:done'
  $singOut = Join-Path $Runtime 'singbox.stdout.log'
  $singErr = Join-Path $Runtime 'singbox.stderr.log'
  Write-Stage 'sing:start'
  $sing = Start-Tracked -File $SingBoxExe -ProcessArgs @('run','-c',$SingConfig) -PidPath $SingPid -Stdout $singOut -Stderr $singErr
  Start-Sleep -Seconds 5
  if ($sing.HasExited) { throw "sing-box exited: $(Get-Content $singErr -Tail 100 -ErrorAction SilentlyContinue | Out-String)" }
  Write-Stage 'sing:alive'

  Write-Stage 'system-verify:start'
  $systemInfo = Invoke-NetworkInfo
  Write-Stage "system-verify:network country=$($systemInfo.country) ip=$($systemInfo.ip)"
  $countryOk = (([string]$systemInfo.country).ToUpperInvariant() -eq $target.country)
  $ipChanged = ($systemInfo.ip -and $baseline.ip -and $systemInfo.ip -ne $baseline.ip)
  $torMatch = ($systemInfo.ip -and $torInfo.ip -and $systemInfo.ip -eq $torInfo.ip)

  Write-Stage 'ipv6:start'
  $ipv6Blocked = Test-IPv6Blocked
  Write-Stage "ipv6:done blocked=$ipv6Blocked"

  Write-Stage 'adapter:start'
  $adapter = [bool](Get-NetAdapter -Name 'HighGAS' -ErrorAction SilentlyContinue)
  Write-Stage "adapter:done present=$adapter"
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
  Write-Stage 'state:save'
  Save-State $Code $target.country ([string]$systemInfo.ip) $checks
  Write-Stage 'complete'
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
  exit 0
} catch {
  if ($Command -eq 'connect') {
    Write-Stage ("error: " + $_.Exception.Message)
    try { Recover-HighGAS } catch {}
  }
  Write-Error $_
  exit 1
}
