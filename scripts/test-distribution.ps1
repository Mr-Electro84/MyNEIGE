[CmdletBinding()]
param([string]$Payload)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'distribution-common.ps1')
$metadata = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (!$Payload) { $Payload = Join-Path $root ('dist\MyNEIGE-' + $metadata.version + '-win-x64') }
$Payload = [IO.Path]::GetFullPath($Payload)
$checks = 0
function Assert-Distribution([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }; $script:checks++
}
$manifest = Test-DistributionPayload $Payload
Assert-Distribution ($manifest.version -ceq $metadata.version) 'Wrong shipped version.'
Assert-Distribution (!(Get-ChildItem -LiteralPath $Payload -Recurse -File -Filter '*.ovpn')) 'VPN profile must not be shipped.'
foreach ($excluded in @('node_modules','.git','.local','state','tests','native','scripts\build-poc.ps1')) {
    Assert-Distribution (!(Test-Path -LiteralPath (Join-Path $Payload $excluded))) "Development content shipped: $excluded"
}
foreach ($executable in @('MyNEIGE.exe','bin\myneige-controller.exe','bin\myneige-vault.exe')) {
    $file = Join-Path $Payload $executable
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($file)
    Assert-Distribution ($version.ProductVersion -ceq $metadata.version -and $version.CompanyName -ceq 'Matra DevProd') "Wrong executable metadata: $executable"
    $bytes = [IO.File]::ReadAllBytes($file)
    $pe = [BitConverter]::ToInt32($bytes, 0x3c)
    Assert-Distribution ([BitConverter]::ToUInt16($bytes, $pe + 4) -eq 0x8664) "Non-x64 executable: $executable"
}
$fixtureRoot = Join-Path $root ('.local\distribution-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
    # Small fixture tests real integrity failures without changing shipped files.
    $fixtureFiles = @()
    foreach ($entry in $manifest.files | Where-Object { $_.path -notlike 'resources/runtime/*' -or $_.path -eq 'resources/runtime/electron.exe' }) {
        $target = Get-PayloadPath $fixtureRoot $entry.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        if ($entry.path -eq 'package.json') { Copy-Item -LiteralPath (Join-Path $Payload 'package.json') -Destination $target }
        else { [IO.File]::WriteAllText($target, 'local distribution fixture') }
        $fixtureFiles += [pscustomobject]@{ path = $entry.path; sha256 = (Get-FileHash -LiteralPath $target).Hash }
    }
    $fixtureManifest = [ordered]@{ product='MyNEIGE'; schema=1; architecture='x64'; version=$manifest.version; files=$fixtureFiles }
    $fixtureManifestPath = Join-Path $fixtureRoot 'distribution.json'
    function Save-Fixture { [IO.File]::WriteAllText($fixtureManifestPath, ($fixtureManifest | ConvertTo-Json -Depth 5)) }
    Save-Fixture
    $null = Test-DistributionPayload $fixtureRoot; $checks++
    $victim = Join-Path $fixtureRoot 'resources\runtime\electron.exe'
    [IO.File]::WriteAllText($victim, 'corrupt runtime')
    $rejected = $false
    try { $null = Test-DistributionPayload $fixtureRoot } catch { $rejected = $_.Exception.Message -like '*altere*' }
    Assert-Distribution $rejected 'A changed runtime was accepted.'
    Remove-Item -LiteralPath $victim
    $rejected = $false
    try { $null = Test-DistributionPayload $fixtureRoot } catch { $rejected = $_.Exception.Message -like '*manquant*' }
    Assert-Distribution $rejected 'A missing runtime was accepted.'
    foreach ($path in @('../outside','/absolute','C:/Windows/win.ini','src/../../outside','src\main\index.js','src/./index.js')) {
        $rejected = $false
        try { $null = Get-PayloadPath $fixtureRoot $path } catch { $rejected = $true }
        Assert-Distribution $rejected "Escaping manifest path accepted: $path"
    }
    [IO.File]::WriteAllText($victim, 'local distribution fixture')
    $fixtureFiles[0].sha256 = 'invalid hash'
    Save-Fixture
    $rejected = $false
    try { $null = Test-DistributionPayload $fixtureRoot } catch { $rejected = $_.Exception.Message -like '*invalide*' }
    Assert-Distribution $rejected 'Malformed checksum accepted.'
    $fixtureFiles[0].sha256 = (Get-FileHash -LiteralPath (Get-PayloadPath $fixtureRoot $fixtureFiles[0].path)).Hash
    $originalPath = $fixtureFiles[0].path
    foreach ($path in @('../outside','/absolute','C:/Windows/win.ini','src/../../outside','src\main\index.js','src/./index.js','src/main/index.js.','src//main/index.js')) {
        $fixtureFiles[0].path = $path
        Save-Fixture
        $rejected = $false
        try { $null = Test-DistributionPayload $fixtureRoot } catch { $rejected = $true }
        Assert-Distribution $rejected "Native integrity checker accepted an invalid path: $path"
    }
    $fixtureFiles[0].path = $originalPath
    $fixtureManifest.files = @($fixtureFiles) + [pscustomobject]@{path=$originalPath.ToUpperInvariant();sha256=$fixtureFiles[0].sha256}
    Save-Fixture
    $rejected = $false
    try { $null = Test-DistributionPayload $fixtureRoot } catch { $rejected = $true }
    Assert-Distribution $rejected 'Case-insensitive duplicate manifest paths were accepted.'
    $fixtureManifest.files = @($fixtureFiles | Where-Object { $_.path -ne 'src/main/index.js' })
    Save-Fixture
    $rejected = $false
    try { $null = Test-DistributionPayload $fixtureRoot } catch { $rejected = $true }
    Assert-Distribution $rejected 'A required file omitted from the manifest was accepted.'
    [IO.File]::WriteAllText($fixtureManifestPath, '{"schema":')
    $rejected = $false
    try { $null = Test-DistributionPayload $fixtureRoot } catch { $rejected = $true }
    Assert-Distribution $rejected 'Malformed JSON did not fail closed.'
} finally {
    $intendedParent = [IO.Path]::GetFullPath((Join-Path $root '.local')) + '\'
    if (![IO.Path]::GetFullPath($fixtureRoot).StartsWith($intendedParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup.' }
    Assert-PlainTree $fixtureRoot
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
}
& (Join-Path $Payload 'bin\myneige-controller.exe') self-test
Assert-Distribution ($LASTEXITCODE -eq 0) 'Shipped native protocol tests failed.'
& (Join-Path $Payload 'bin\myneige-vault.exe') vault-capabilities
Assert-Distribution ($LASTEXITCODE -eq 0) 'Shipped dedicated vault failed.'
Write-Output "DISTRIBUTION_TEST checks=$checks manifest=true corruption_refused=true profile_embedded=false x64=true no_network_changes=true"
