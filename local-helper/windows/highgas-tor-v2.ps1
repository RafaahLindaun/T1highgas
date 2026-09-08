param(
  [ValidateSet('up','down','status','verify','recover')][string]$Action = 'status',
  [string]$Server = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Base = if ($env:HIGHGAS_BASE) { $env:HIGHGAS_BASE } else { Join-Path $env:ProgramData 'HighGAS' }
$Runtime = Join-Path $Base 'runtime'
$StateFile = Join-Path $Runtime 'state.json'
$TorRoot = Join-Path $Base 'tor-expert'
$TorExe = Join-Path $TorRoot 'tor\tor.exe'
$GeoIP = Join-Path $TorRoot 'data\geoip'
$GeoIP6 = Join-Path $TorRoot 'data\geoip6'
$TunExe = Join-Path $Base 'tun2socks.exe'
$Wintun = Join-Path $Base 'wintun.dll'
$TorData = Join-Path $Runtime 'tor-data'
$TorLog = Join-Path $Runtime 'tor.log'
$TunLog = Join-Path $Runtime 'tun2socks.log'
$CheckUrl = 'https://lowgas.vercel.app/api/network-info'
$IPv6Url = 'https://api64.ipify.org'
$SocksPort = 39050
$DnsPort = 53
$FirewallGroup = 'HighGAS Full Tunnel'
$TunAddress = '192.168.123.1'
$Expected = @{ 'de-fra-01' = 'DE'; 'us-mia-01' = 'US' }
$Exit = @{ 'de-fra-01' = 'de'; 'us-mia-01' = 'us' }

New-Item -ItemType Directory -Force -Path $Runtime,$TorData | Out-Null

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-State {
  if (!(Test-Path $StateFile)) { return $null }
  try { return (Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json) } catch { return $null }
}

function Write-State([object]$State) {
  $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

function Stop-Pid([object]$PidValue) {
  if ($null -eq $PidValue) { return }
  $n = 0
  if ([int]::TryParse([string]$PidValue,[ref]$n)) {
    Stop-Process -Id $n -Force -ErrorAction SilentlyContinue
    for ($i=0;$i -lt 20;$i++) {
      if (!(Get-Process -Id $n -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 100
    }
  }
}

function Remove-HighGASRules {
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

function Restore-Firewall([object]$State) {
  if ($null -eq $State -or $null -eq $State.firewall) { return }
  foreach ($f in @($State.firewall)) {
    try { Set-NetFirewallProfile -Profile ([string]$f.Name) -DefaultOutboundAction ([string]$f.DefaultOutboundAction) | Out-Null } catch {
      try { Set-NetFirewallProfile -Profile ([string]$f.Name) -DefaultOutboundAction Allow | Out-Null } catch {}
    }
  }
}

function Remove-HighGASRoutes([object]$State) {
  if ($null -eq $State) { return }
  if ($State.PSObject.Properties.Name -contains 'tunAlias' -and $State.tunAlias) {
    Get-NetRoute -InterfaceAlias ([string]$State.tunAlias) -PolicyStore ActiveStore -ErrorAction SilentlyContinue |
      Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' } |
      Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
  }
  if ($State.PSObject.Properties.Name -contains 'guardRoutes' -and $State.guardRoutes) {
    foreach ($r in @($State.guardRoutes)) {
      Get-NetRoute -DestinationPrefix ([string]$r -ErrorAction SilentlyContinue) -ErrorAction SilentlyContinue | Out-Null
      Get-NetRoute -DestinationPrefix ([string]$r) -PolicyStore ActiveStore -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceIndex -eq [int]$State.physicalIndex } |
        Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    }
  }
}

function Down {
  $s = Read-State
  # Fail-closed: primeiro retira a rota das aplicações enquanto o bloqueio continua ativo.
  Remove-HighGASRoutes $s
  if ($s) {
    if ($s.PSObject.Properties.Name -contains 'tunPid') { Stop-Pid $s.tunPid }
    if ($s.PSObject.Properties.Name -contains 'torPid') { Stop-Pid $s.torPid }
  }
  Get-Process tun2socks -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-Process tor -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$Base*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($s -and $s.PSObject.Properties.Name -contains 'tunAlias' -and $s.tunAlias) {
    Set-DnsClientServerAddress -InterfaceAlias ([string]$s.tunAlias) -ResetServerAddresses -ErrorAction SilentlyContinue
  }
  Remove-HighGASRules
  Restore-Firewall $s
  Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
  Clear-DnsClientCache -ErrorAction SilentlyContinue
  'disconnected'
}

function Get-PhysicalNetwork {
  $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
    Where-Object { $_.NextHop -ne '0.0.0.0' -and $_.InterfaceAlias -notmatch '(?i)wintun|highgas' } |
    Sort-Object @{Expression={ $_.RouteMetric + $_.InterfaceMetric }},RouteMetric
  $r = $routes | Select-Object -First 1
  if (!$r) { throw 'Não encontrei a rota principal do Windows.' }
  $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.InterfaceIndex -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
  if (!$ip) { throw 'Não encontrei o IPv4 da conexão principal.' }
  [pscustomobject]@{ Alias=$r.InterfaceAlias; Index=$r.InterfaceIndex; Gateway=$r.NextHop; IP=$ip.IPAddress }
}

function Public-Info([int]$Timeout=18) {
  $raw = & curl.exe -4 -fsS --connect-timeout 6 --max-time $Timeout -H 'Accept: application/json' "$CheckUrl?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" 2>$null
  if ($LASTEXITCODE -ne 0 -or !$raw) { return $null }
  try { return ($raw | ConvertFrom-Json) } catch { return $null }
}

function Tor-Info([string]$Country) {
  $raw = & curl.exe -4 -fsS --socks5-hostname "127.0.0.1:$SocksPort" --connect-timeout 8 --max-time 25 -H 'Accept: application/json' "$CheckUrl?tor=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" 2>$null
  if ($LASTEXITCODE -ne 0 -or !$raw) { return $null }
  try {
    $j = $raw | ConvertFrom-Json
    if (([string]$j.country).ToUpperInvariant() -ne $Country) { return $null }
    return $j
  } catch { return $null }
}

function Start-Tor([object]$Physical,[string]$Country,[string]$ExitCode) {
  Remove-Item -LiteralPath $TorLog -Force -ErrorAction SilentlyContinue
  $args = @(
    '--SocksPort',"127.0.0.1:$SocksPort",
    '--DNSPort',"127.0.0.1:$DnsPort",
    '--DataDirectory',$TorData,
    '--GeoIPFile',$GeoIP,
    '--GeoIPv6File',$GeoIP6,
    '--ExitNodes',"{$ExitCode}",
    '--StrictNodes','1',
    '--ClientUseIPv6','0',
    '--OutboundBindAddress',[string]$Physical.IP,
    '--Log','notice stdout'
  )
  $p = Start-Process -FilePath $TorExe -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput $TorLog -RedirectStandardError (Join-Path $Runtime 'tor-error.log')
  for ($i=0;$i -lt 360;$i++) {
    if ($p.HasExited) { throw 'O Tor encerrou durante a inicialização.' }
    if ((Test-Path $TorLog) -and (Select-String -LiteralPath $TorLog -Pattern 'Bootstrapped 100%' -SimpleMatch -Quiet -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (!(Test-Path $TorLog) -or !(Select-String -LiteralPath $TorLog -Pattern 'Bootstrapped 100%' -SimpleMatch -Quiet -ErrorAction SilentlyContinue)) { throw 'O Tor não concluiu o bootstrap.' }
  $probe = $null
  for ($i=0;$i -lt 12;$i++) {
    $probe = Tor-Info $Country
    if ($probe) { break }
    Start-Sleep -Seconds 2
  }
  if (!$probe) { throw "O Tor não confirmou saída $Country." }
  return $p
}

function Add-TorGuardRoutes([int]$TorPid,[object]$Physical,[string[]]$Existing=@()) {
  $prefixes = New-Object System.Collections.Generic.List[string]
  foreach ($x in @($Existing)) { if ($x -and !$prefixes.Contains([string]$x)) { $prefixes.Add([string]$x) } }
  $connections = Get-NetTCPConnection -OwningProcess $TorPid -State Established -ErrorAction SilentlyContinue
  foreach ($c in @($connections)) {
    $ip = [string]$c.RemoteAddress
    if ($ip -match '^\d+\.\d+\.\d+\.\d+$' -and $ip -ne '127.0.0.1') {
      $prefix = "$ip/32"
      if (!$prefixes.Contains($prefix)) {
        New-NetRoute -DestinationPrefix $prefix -InterfaceIndex ([int]$Physical.Index) -NextHop ([string]$Physical.Gateway) -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Out-Null
        $prefixes.Add($prefix)
      }
    }
  }
  if ($prefixes.Count -eq 0) { throw 'Não consegui fixar a rota dos relays Tor.' }
  return @($prefixes)
}

function Enable-KillSwitch([object]$Physical) {
  Remove-HighGASRules
  New-NetFirewallRule -DisplayName 'HighGAS Loopback' -Group $FirewallGroup -Direction Outbound -Action Allow -Profile Any -RemoteAddress '127.0.0.0/8' | Out-Null
  New-NetFirewallRule -DisplayName 'HighGAS Tor TCP' -Group $FirewallGroup -Direction Outbound -Action Allow -Profile Any -Program $TorExe -Protocol TCP -InterfaceAlias ([string]$Physical.Alias) | Out-Null
  New-NetFirewallRule -DisplayName 'HighGAS DHCP' -Group $FirewallGroup -Direction Outbound -Action Allow -Profile Any -Protocol UDP -LocalPort 68 -RemotePort 67 | Out-Null
  Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block | Out-Null
}

function Start-Tun {
  Remove-Item -LiteralPath $TunLog -Force -ErrorAction SilentlyContinue
  # O proxy é localhost. Não passe o nome da interface como argumento: aliases do Windows podem conter espaços.
  $argLine = "--device wintun --proxy socks5://127.0.0.1:$SocksPort --loglevel info"
  $p = Start-Process -FilePath $TunExe -ArgumentList $argLine -WorkingDirectory $Base -WindowStyle Hidden -PassThru -RedirectStandardOutput $TunLog -RedirectStandardError (Join-Path $Runtime 'tun2socks-error.log')
  $adapter = $null
  for ($i=0;$i -lt 100;$i++) {
    if ($p.HasExited) {
      $err = Get-Content -LiteralPath (Join-Path $Runtime 'tun2socks-error.log') -Raw -ErrorAction SilentlyContinue
      throw "tun2socks encerrou antes de criar o Wintun. $err"
    }
    $adapter = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'wintun' -or $_.InterfaceDescription -match '(?i)Wintun' } | Select-Object -First 1
    if ($adapter) { break }
    Start-Sleep -Milliseconds 200
  }
  if (!$adapter) { throw 'O adaptador Wintun não foi criado.' }
  & netsh.exe interface ipv4 set address name="$($adapter.Name)" source=static addr=$TunAddress mask=255.255.255.0 gateway=none | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Não consegui configurar o IPv4 do Wintun.' }
  Set-NetIPInterface -InterfaceAlias $adapter.Name -AddressFamily IPv4 -InterfaceMetric 1 -ErrorAction Stop | Out-Null
  Set-DnsClientServerAddress -InterfaceAlias $adapter.Name -ServerAddresses '127.0.0.1' -ErrorAction Stop
  New-NetFirewallRule -DisplayName 'HighGAS Wintun TCP IPv4' -Group $FirewallGroup -Direction Outbound -Action Allow -Profile Any -InterfaceAlias $adapter.Name -Protocol TCP -RemoteAddress '0.0.0.0/0' | Out-Null
  New-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceAlias $adapter.Name -NextHop $TunAddress -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction Stop | Out-Null
  return [pscustomobject]@{ Process=$p; Adapter=$adapter }
}

function Test-Dns([string]$TunAlias) {
  try {
    $dns = (Get-DnsClientServerAddress -InterfaceAlias $TunAlias -AddressFamily IPv4 -ErrorAction Stop).ServerAddresses
    if ($dns -notcontains '127.0.0.1') { return $false }
    $r = Resolve-DnsName -Name 'lowgas.vercel.app' -Server '127.0.0.1' -Type A -DnsOnly -ErrorAction Stop | Where-Object { $_.IPAddress -match '^\d+\.' } | Select-Object -First 1
    return [bool]$r
  } catch { return $false }
}

function Test-IPv6Blocked {
  & curl.exe -6 -fsS --connect-timeout 2 --max-time 5 $IPv6Url *> $null
  return ($LASTEXITCODE -ne 0)
}

function Test-KillSwitch([object]$State) {
  try {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceAlias ([string]$State.tunAlias) -PolicyStore ActiveStore -ErrorAction Stop | Select-Object -First 1
    if (!$route) { return $false }
    $profiles = Get-NetFirewallProfile -Profile Domain,Private,Public
    if (@($profiles | Where-Object { [string]$_.DefaultOutboundAction -ne 'Block' }).Count -ne 0) { return $false }
    $rule = Get-NetFirewallRule -Group $FirewallGroup -ErrorAction Stop | Where-Object { $_.DisplayName -eq 'HighGAS Wintun TCP IPv4' -and $_.Enabled -eq 'True' }
    return [bool]$rule
  } catch { return $false }
}

function Verification-Lines {
  $s = Read-State
  $ip = ''; $country = ''; $ipOk=0; $countryOk=0; $dnsOk=0; $ipv6Ok=0; $routeOk=0
  if ($s) {
    $info = Public-Info 25
    if ($info) {
      $ip = [string]$info.ip; $country = ([string]$info.country).ToUpperInvariant()
      if ($ip -and $s.baselineIp -and $ip -ne [string]$s.baselineIp) { $ipOk=1 }
      if ($country -eq [string]$s.expected) { $countryOk=1 }
    }
    if (Test-Dns ([string]$s.tunAlias)) { $dnsOk=1 }
    if (Test-IPv6Blocked) { $ipv6Ok=1 }
    if (Test-KillSwitch $s) { $routeOk=1 }
  }
  "IP=$ip"
  "COUNTRY=$country"
  "IP_CHANGED=$ipOk"
  "COUNTRY_OK=$countryOk"
  "DNS_OK=$dnsOk"
  "IPV6_OK=$ipv6Ok"
  "ROUTE_OK=$routeOk"
  $verified = if ($ipOk -eq 1 -and $countryOk -eq 1 -and $dnsOk -eq 1 -and $ipv6Ok -eq 1 -and $routeOk -eq 1) { 1 } else { 0 }
  "VERIFIED=$verified"
}

function Up([string]$Code) {
  if (!(Test-Admin)) { throw 'O HighGAS precisa executar como Administrador.' }
  if (!$Expected.ContainsKey($Code)) { throw 'Servidor inválido.' }
  foreach ($f in @($TorExe,$GeoIP,$GeoIP6,$TunExe,$Wintun)) { if (!(Test-Path $f)) { throw "Arquivo ausente: $f" } }
  Down | Out-Null
  $physical = Get-PhysicalNetwork
  $baseline = Public-Info 15
  if (!$baseline -or !$baseline.ip) { throw 'Não consegui medir o IP real antes de ligar.' }
  $fw = @(Get-NetFirewallProfile -Profile Domain,Private,Public | ForEach-Object { [pscustomobject]@{ Name=[string]$_.Name; DefaultOutboundAction=[string]$_.DefaultOutboundAction } })
  $state = [ordered]@{
    stage='locking'; server=$Code; expected=$Expected[$Code]; baselineIp=[string]$baseline.ip;
    physicalAlias=[string]$physical.Alias; physicalIndex=[int]$physical.Index; gateway=[string]$physical.Gateway; physicalIP=[string]$physical.IP;
    firewall=$fw; guardRoutes=@(); torPid=0; tunPid=0; tunAlias=''; started=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  }
  Write-State $state
  try {
    Enable-KillSwitch $physical
    $tor = Start-Tor $physical $Expected[$Code] $Exit[$Code]
    $state.torPid = $tor.Id; $state.stage='tor'; Write-State $state
    $guards = Add-TorGuardRoutes $tor.Id $physical @()
    $state.guardRoutes = @($guards); Write-State $state
    $tun = Start-Tun
    $state.tunPid = $tun.Process.Id; $state.tunAlias = [string]$tun.Adapter.Name; $state.stage='verifying'; Write-State $state
    Clear-DnsClientCache -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $v = @(Verification-Lines)
    $v | ForEach-Object { Write-Output $_ }
    if ($v -notcontains 'VERIFIED=1') { throw 'A verificação completa não passou; o HighGAS desligou para evitar vazamento.' }
    $state.stage='connected'; Write-State $state
    'connected'
  } catch {
    $msg = $_.Exception.Message
    Down | Out-Null
    throw $msg
  }
}

function Status {
  $s = Read-State
  if (!$s -or [string]$s.stage -ne 'connected') { 'disconnected'; return }
  if (!(Get-Process -Id ([int]$s.torPid) -ErrorAction SilentlyContinue) -or !(Get-Process -Id ([int]$s.tunPid) -ErrorAction SilentlyContinue)) {
    Down | Out-Null; 'disconnected'; return
  }
  if (!(Test-KillSwitch $s) -or !(Test-Dns ([string]$s.tunAlias))) {
    Down | Out-Null; 'disconnected'; return
  }
  # Guard nodes Tor são duradouros; atualiza qualquer conexão já estabelecida sem abrir a rota das aplicações.
  try {
    $physical = [pscustomobject]@{ Alias=[string]$s.physicalAlias; Index=[int]$s.physicalIndex; Gateway=[string]$s.gateway; IP=[string]$s.physicalIP }
    $routes = Add-TorGuardRoutes ([int]$s.torPid) $physical @($s.guardRoutes)
    if (@($routes).Count -ne @($s.guardRoutes).Count) { $s.guardRoutes=@($routes); Write-State $s }
  } catch {}
  "connected tor $([string]$s.expected) $([string]$s.server) $([string]$s.started)"
}

switch ($Action) {
  'up' { Up $Server }
  'down' { Down }
  'recover' { if (Test-Path $StateFile) { Down | Out-Null }; 'recovered' }
  'status' { Status }
  'verify' { Verification-Lines }
}
