[CmdletBinding()]
param([switch]$Worker)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root '.local\j1-tools'
New-Item -ItemType Directory -Path $out -Force | Out-Null
if (!$Worker) {
    $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Worker')
    if (!$p.WaitForExit(60000)) { throw 'Inspection encore active.' }
    Get-Content (Join-Path $out 'privilege.txt')
    Get-Content (Join-Path $out 'status.txt')
    Get-Content (Join-Path $out 'filters.txt')
    exit $p.ExitCode
}
$ErrorActionPreference = 'Continue'
& (Join-Path $root '.local\poc\myneige-poc.exe') privilege-test 2>&1 | Out-File (Join-Path $out 'privilege.txt') -Encoding utf8
$code = $LASTEXITCODE
& pktmon status 2>&1 | Out-File (Join-Path $out 'status.txt') -Encoding utf8
& pktmon filter list 2>&1 | Out-File (Join-Path $out 'filters.txt') -Encoding utf8
& pktmon list --json 2>&1 | Out-File (Join-Path $out 'components.json') -Encoding utf8
exit $code
