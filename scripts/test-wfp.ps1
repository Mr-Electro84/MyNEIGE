[CmdletBinding()]
param([switch]$Elevate, [switch]$ElevatedChild, [ValidateSet('wfp-test','adapter-test','auth-preflight','management-test','privilege-test','browser-test','public-network-test','all')][string]$TestCommand = 'wfp-test')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $repoRoot '.local\poc\myneige-poc.exe'
if (!(Test-Path -LiteralPath $binary)) { throw 'Compiler le pilote avec npm run poc:build avant le test WFP.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$resultFile = Join-Path $repoRoot ('.local\poc\' + $TestCommand + '.txt')
if (!$isAdmin) {
    if (!$Elevate) { throw 'Test WFP : console administrateur requise, ou utiliser -Elevate pour la demande UAC.' }
    # The test has no credential input. Run the elevated helper hidden and return its sanitized result.
    $scriptPath = $PSCommandPath
    if (Test-Path -LiteralPath $resultFile) { Remove-Item -LiteralPath $resultFile }
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $scriptPath + '"'),'-ElevatedChild','-TestCommand',$TestCommand)
    if (!$process.WaitForExit(60000)) { throw 'Tests encore actifs apres 60 secondes ; consulter le processus avant de relancer.' }
    if (Test-Path -LiteralPath $resultFile) { Get-Content -LiteralPath $resultFile }
    exit $process.ExitCode
}
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$commands = @($TestCommand)
if ($TestCommand -eq 'all') { $commands = @('wfp-test','adapter-test','privilege-test','auth-preflight','management-test') }
$result = @()
$nativeCode = 0
foreach ($command in $commands) {
    if ($ElevatedChild) {
        $result += & $binary $command --profile (Join-Path $repoRoot 'tests/fixtures/synthetic.ovpn') --project-root $repoRoot 2>&1 | Tee-Object -FilePath $resultFile -Append
    } else {
        $result += & $binary $command --profile (Join-Path $repoRoot 'tests/fixtures/synthetic.ovpn') --project-root $repoRoot 2>&1
    }
    $nativeCode = $LASTEXITCODE
    if ($nativeCode -ne 0) { break }
}
$ErrorActionPreference = $previousPreference
if (!$ElevatedChild) { $result | Write-Output }
exit $nativeCode
