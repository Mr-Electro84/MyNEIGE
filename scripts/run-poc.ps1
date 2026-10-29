[CmdletBinding()]
param([string]$Profile,
    [ValidateSet('inspect','self-test','wfp-test','adapter-test','auth-preflight','management-test','connect','cleanup')][string]$Mode = 'inspect',
    [string]$OpenVpn = 'C:\Program Files\OpenVPN\bin\openvpn.exe',
    [string[]]$VpnDns = @(),
    [string]$VpnGateway,
    [ValidateRange(1,60)][int]$Seconds = 30
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $repoRoot '.local\poc\myneige-poc.exe'
if (!(Test-Path -LiteralPath $binary)) { & (Join-Path $PSScriptRoot 'build-poc.ps1') }
if (!(Test-Path -LiteralPath $binary)) { throw 'Le pilote doit etre compile avant execution.' }
$nativeArgs = @($Mode)
if ($Mode -in @('inspect','connect','adapter-test','auth-preflight','management-test')) {
    if (!$Profile) { throw 'Fournir -Profile avec le chemin du profil personnel.' }
    $nativeArgs += @('--profile', $Profile, '--openvpn', $OpenVpn)
    foreach ($server in $VpnDns) { $nativeArgs += @('--dns', $server) }
    if ($VpnGateway) { $nativeArgs += @('--gateway', $VpnGateway) }
    $nativeArgs += @('--seconds', [string]$Seconds)
}
& $binary @nativeArgs
exit $LASTEXITCODE
