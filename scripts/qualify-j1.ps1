[CmdletBinding()]
param([string]$Profile, [switch]$Worker, [switch]$ProbeOnly, [switch]$NormalOnly, [ValidateRange(5,30)][int]$Seconds = 30)
$ErrorActionPreference = 'Stop'
if (!$Profile) { throw 'Fournir -Profile avec le chemin du profil personnel.' }
$Profile = (Resolve-Path -LiteralPath $Profile).Path
if (!$ProbeOnly -and $Seconds -lt 20) { throw 'Une fenetre stable de 20 secondes minimum est requise pour le temoin curl.' }
$root = Split-Path -Parent $PSScriptRoot
if (!$Worker) {
    $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Worker','-Profile',('"'+$Profile+'"'),'-Seconds',[string]$Seconds)
    if ($ProbeOnly) { $arguments += '-ProbeOnly' }
    if ($NormalOnly) { $arguments += '-NormalOnly' }
    if (!$ProbeOnly) { $arguments = @('-NoExit') + $arguments }
    $launch = @{ FilePath='powershell.exe'; Verb='RunAs'; PassThru=$true; ArgumentList=$arguments }
    if ($ProbeOnly) { $launch.WindowStyle = 'Hidden' }
    $p = Start-Process @launch
    if ($ProbeOnly) {
        if (!$p.WaitForExit(60000)) { throw 'Sonde de capture encore active.' }
        Get-Content (Join-Path $root '.local\j1-latest.txt')
        exit $p.ExitCode
    }
    Write-Output "Console de recette J1 lancee (PID $($p.Id)). Saisie locale pour chaque generation VPN testee."
    return
}
$run = Join-Path $root ('.local\j1\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $run -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $root '.local\j1-latest.txt'), $run)
$binary = Join-Path $root '.local\poc\myneige-poc.exe'
$ErrorActionPreference = 'Continue'
$status = (& pktmon status 2>&1 | Out-String)
$filters = (& pktmon filter list 2>&1 | Out-String)
if ($status -notmatch 'not running|pas en cours' -or $filters -notmatch 'Aucun|None|No filters') {
    throw "Pktmon est deja utilise ou contient des filtres. Aucune capture ni aucun filtre existant n'a ete modifie."
}
& $binary privilege-test 2>&1 | Tee-Object -FilePath (Join-Path $run 'privilege.txt')
if ($LASTEXITCODE -ne 0) { throw 'Le controle des privileges doit passer avant les essais VPN.' }
$before = (& $binary inspect --profile $Profile 2>&1)
$before | Out-File (Join-Path $run 'inspect-before.txt') -Encoding utf8
Get-NetRoute | Select-Object InterfaceIndex,AddressFamily,DestinationPrefix,NextHop,RouteMetric | ConvertTo-Json -Depth 4 | Out-File (Join-Path $run 'routes-before.json') -Encoding utf8
Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 5 | Out-File (Join-Path $run 'dns-before.json') -Encoding utf8
$started = $false
$filtersCreated = $false
$nativeCodes = @()
function Invoke-OrdinaryControl([string]$Target, [string]$Phase) {
    $parsed = $null
    if (![Net.IPAddress]::TryParse($Target, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Adresse temoin invalide.' }
    $reserve = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, 0)
    $reserve.Start()
    $port = $reserve.LocalEndpoint.Port
    $reserve.Stop()
    # Source port is selected solely to identify this independent application's packets.
    # No source address or interface is forced; curl uses the ordinary host route.
    & (Join-Path $env:WINDIR 'System32\curl.exe') --noproxy '*' --resolve ('www.appigs.univ-avignon.fr:443:'+$Target) --local-port ([string]$port) --connect-timeout 8 --max-time 10 --head --silent --output NUL 'https://www.appigs.univ-avignon.fr/extranet/etu_suivi.html' 2>$null
    $curlCode = $LASTEXITCODE
    if ($Phase -eq 'active' -and (!(Get-Process -Id $vpnProcessId -ErrorAction SilentlyContinue) -or !(Get-Process -Id $relayProcessId -ErrorAction SilentlyContinue))) {
        $Phase = 'unproven'
    }
    "HOST_CONTROL_FLOW source=0.0.0.0:$port destination=${Target}:443 application=curl phase=$Phase exit=$curlCode" | Tee-Object -FilePath (Join-Path $run 'control-flows.txt') -Append
}
try {
    # Only headers and a few following bytes; no loopback management/proxy ports are selected.
    foreach ($entry in @(@('MyNEIGE-DNS','-p','53'),@('MyNEIGE-TLS','-t','TCP','-p','443'),@('MyNEIGE-QUIC','-t','UDP','-p','443'),@('MyNEIGE-STUN','-t','UDP','-p','3478'),@('MyNEIGE-ICMP','-t','ICMP'))) {
        & pktmon filter add @entry | Out-File (Join-Path $run 'capture-tools.txt') -Append -Encoding utf8
        if ($LASTEXITCODE -ne 0) { throw 'Creation du filtre de capture echouee.' }
        $filtersCreated = $true
    }
    & pktmon start --capture --comp all --pkt-size 96 --flags 0x032 --file-size 64 --file-name (Join-Path $run 'capture.etl') | Out-File (Join-Path $run 'capture-tools.txt') -Append -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Demarrage de capture echoue.' }
    $started = $true
    & pktmon list --json | Out-File (Join-Path $run 'components-before.json') -Encoding utf8
    if ($ProbeOnly) {
        $gateway = (Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop
        & ping.exe -n 1 -w 1000 $gateway | Out-File (Join-Path $run 'probe.txt') -Encoding utf8
    } else {
        $scenarios = @('qualify','qualify-crash')
        if ($NormalOnly) { $scenarios = @('qualify') }
        foreach ($scenario in $scenarios) {
            $lastTarget = $null
            $vpnProcessId = 0
            $relayProcessId = 0
            Write-Host "Recette $scenario : saisir les identifiants uniquement dans cette console."
            & $binary $scenario --profile $Profile --seconds ([string]$Seconds) 2>&1 | ForEach-Object {
                $_ | Tee-Object -FilePath (Join-Path $run ($scenario+'.txt')) -Append
                if ([string]$_ -match '^VPN_INTERFACE index=') {
                    & pktmon list --json | Out-File (Join-Path $run ($scenario+'-components.json')) -Encoding utf8
                }
                if ([string]$_ -match '^TARGET_IPV4 ([\d.]+) ') {
                    $lastTarget = $Matches[1]
                }
                if ([string]$_ -match '^SUPERVISED_PROCESS openvpn_pid=(\d+) relay_pid=(\d+)') {
                    $vpnProcessId = [int]$Matches[1]
                    $relayProcessId = [int]$Matches[2]
                }
                if ([string]$_ -match '^READY_FOR_CAPTURE ' -and $lastTarget) {
                    Invoke-OrdinaryControl $lastTarget 'active'
                }
            }
            $code = $LASTEXITCODE
            $nativeCodes += $code
            if ($scenario -eq 'qualify-crash' -and $code -eq 86) {
                $log = Get-Content (Join-Path $run ($scenario+'.txt')) -Raw
                if ($log -match 'SUPERVISED_PROCESS openvpn_pid=(\d+) relay_pid=(\d+)') {
                    foreach ($processId in @([int]$Matches[1],[int]$Matches[2])) {
                        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw "Enfant encore actif apres crash : $processId" }
                    }
                    'JOB_CHILDREN_STOPPED_AFTER_CRASH' | Tee-Object -FilePath (Join-Path $run 'recovery.txt') -Append
                } else { throw 'Pas de preuve de PID pour le test de crash.' }
                & $binary cleanup 2>&1 | Tee-Object -FilePath (Join-Path $run 'recovery.txt') -Append
                if ($LASTEXITCODE -ne 0) { throw 'Recuperation incomplete : conserver les protections.' }
            } elseif ($code -ne 0) { throw "Scenario $scenario echoue ($code)." }
            if ($lastTarget) { Invoke-OrdinaryControl $lastTarget 'after' }
            $log = Get-Content (Join-Path $run ($scenario+'.txt')) -Raw
            if ($log -match 'PROXY_ENDPOINT port=(\d+)') {
                $client = [Net.Sockets.TcpClient]::new()
                try {
                    $connect = $client.BeginConnect('127.0.0.1', [int]$Matches[1], $null, $null)
                    if ($connect.AsyncWaitHandle.WaitOne(1000)) { try { $client.EndConnect($connect) } catch {} }
                    if ($client.Connected) { throw 'Un ancien port proxy reste accessible apres fermeture.' }
                    'OLD_PROXY_CLOSED' | Tee-Object -FilePath (Join-Path $run ($scenario+'.txt')) -Append
                } finally { $client.Dispose() }
            }
        }
    }
} finally {
    if ($started) { & pktmon stop | Out-File (Join-Path $run 'capture-tools.txt') -Append -Encoding utf8 }
    if ($filtersCreated) { & pktmon filter remove | Out-File (Join-Path $run 'capture-tools.txt') -Append -Encoding utf8 }
    & pktmon list --json | Out-File (Join-Path $run 'components-after.json') -Encoding utf8
    Get-NetRoute | Select-Object InterfaceIndex,AddressFamily,DestinationPrefix,NextHop,RouteMetric | ConvertTo-Json -Depth 4 | Out-File (Join-Path $run 'routes-after.json') -Encoding utf8
    Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 5 | Out-File (Join-Path $run 'dns-after.json') -Encoding utf8
    ConvertTo-Json -InputObject @($nativeCodes) | Out-File (Join-Path $run 'native-exit-codes.json') -Encoding utf8
    if (Test-Path (Join-Path $run 'capture.etl')) {
        & pktmon etl2pcap (Join-Path $run 'capture.etl') --out (Join-Path $run 'capture.pcapng') | Out-File (Join-Path $run 'capture-tools.txt') -Append -Encoding utf8
        & pktmon etl2txt (Join-Path $run 'capture.etl') --out (Join-Path $run 'capture.txt') --brief | Out-File (Join-Path $run 'capture-tools.txt') -Append -Encoding utf8
        $components = @{}
        Get-ChildItem -LiteralPath $run -Filter '*components*.json' | ForEach-Object {
            foreach ($group in (Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json)) {
                foreach ($component in $group.Components) {
                    $index = $component.Properties | Where-Object Name -eq 'ifIndex' | Select-Object -First 1
                    if ($null -ne $index) {
                        $components[[string]$component.Id] = @{ id=$component.Id; ifIndex=[int]$index.Value; name=$component.Name; driver=$component.DriverName }
                    }
                }
            }
        }
        @($components.Values) | ConvertTo-Json -Depth 5 | Out-File (Join-Path $run 'nics.json') -Encoding utf8
        foreach ($component in $components.Values) {
            & pktmon etl2pcap (Join-Path $run 'capture.etl') --component-id ([string]$component.id) --out (Join-Path $run ('component-'+$component.id+'.pcapng')) | Out-File (Join-Path $run 'capture-tools.txt') -Append -Encoding utf8
        }
    }
    Write-Host "Preuves locales : $run"
}
