[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-poc.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$repoRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $repoRoot '.local\poc\myneige-poc.exe') self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Validate the actual supplied profile, rather than only the synthetic fixture.
$result = & (Join-Path $repoRoot '.local\poc\myneige-poc.exe') inspect --profile (Join-Path $repoRoot 'VPN_Universite_Avignon.ovpn')
$inspectCode = $LASTEXITCODE
$result | Write-Output
exit $inspectCode
