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
if ($inspectCode -ne 0) { exit $inspectCode }
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (!$node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (!(Test-Path -LiteralPath $node)) { throw 'Node.js requis pour les tests IPC, URL et captures.' }
$testFiles = Get-ChildItem (Join-Path $repoRoot 'tests') -Filter '*.test.js' | ForEach-Object FullName
& $node --test @testFiles
exit $LASTEXITCODE
