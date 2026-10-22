[CmdletBinding()]
param([switch]$Worker)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root '.local\poc\myneige-poc.exe'
if (!(Test-Path -LiteralPath $binary)) { throw 'Compiler le pilote avant le lancement.' }
$out = Join-Path $root '.local\browser'
New-Item -ItemType Directory -Path $out -Force | Out-Null
if (!$Worker) {
    $exitFile = Join-Path $out 'exit-code.txt'
    if (Test-Path -LiteralPath $exitFile) { Remove-Item -LiteralPath $exitFile }
    $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -WorkingDirectory $root -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Worker')
    Write-Output "MyNEIGE demarre (controleur PID $($p.Id)). Le formulaire s'ouvre apres les controles de protection."
    Write-Output "Diagnostic local sans identifiants : $(Join-Path $out 'live-session.txt')"
    # Keep the launcher alive so execution hosts do not reap the supervised tree.
    $p.WaitForExit()
    exit $p.ExitCode
}
Set-Location -LiteralPath $root
$ErrorActionPreference = 'Continue'
& $binary browse --profile (Join-Path $root 'VPN_Universite_Avignon.ovpn') --project-root $root 2>&1 | Tee-Object -FilePath (Join-Path $out 'live-session.txt')
$code = $LASTEXITCODE
[IO.File]::WriteAllText((Join-Path $out 'exit-code.txt'), [string]$code)
exit $code
