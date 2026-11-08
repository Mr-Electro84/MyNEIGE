[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-poc.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$repoRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'test-windows-platform.ps1')
& (Join-Path $PSScriptRoot 'test-openvpn-setup.ps1')
& (Join-Path $PSScriptRoot 'test-relays.ps1')
& (Join-Path $repoRoot '.local\poc\myneige-poc.exe') self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $repoRoot '.local\poc\myneige-vault.exe') vault-self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Profil synthétique uniquement : aucun accès au profil personnel.
$result = & (Join-Path $repoRoot '.local\poc\myneige-poc.exe') inspect --profile (Join-Path $repoRoot 'tests/fixtures/synthetic.ovpn')
$inspectCode = $LASTEXITCODE
$result | Write-Output
if ($inspectCode -ne 0) { exit $inspectCode }
& (Join-Path $PSScriptRoot 'test-profile-packaging.ps1')
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (!$node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (!(Test-Path -LiteralPath $node)) { throw 'Node.js requis pour les tests IPC, URL et captures.' }
$testFiles = Get-ChildItem (Join-Path $repoRoot 'tests') -Filter '*.test.js' | ForEach-Object FullName
& $node --test @testFiles
exit $LASTEXITCODE
