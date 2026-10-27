[CmdletBinding()]
param([switch]$SkipNativeBuild, [switch]$SkipInstaller, [string]$NsisPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'distribution-common.ps1')
$metadata = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (($metadata.revision -isnot [int] -and $metadata.revision -isnot [long]) -or
    $metadata.revision -lt 1 -or $metadata.revision -gt 9007199254740991) { throw 'Revision de mise a jour entiere positive attendue.' }
if ($metadata.version -notmatch '^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$') { throw 'Version Alpha SemVer attendue.' }
$windowsVersion = @($Matches[1],$Matches[2],$Matches[3],$Matches[4]) -join '.'
$name = 'MyNEIGE-' + $metadata.version + '-win-x64'
$dist = [IO.Path]::GetFullPath((Join-Path $root 'dist'))
$payload = [IO.Path]::GetFullPath((Join-Path $dist $name))
if (!$payload.StartsWith(($dist + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination de construction invalide.' }
$runtime = Join-Path $root 'node_modules\electron\dist'
if (!(Test-Path -LiteralPath (Join-Path $runtime 'electron.exe'))) { throw 'Installer les dependances avec npm ci avant de construire.' }
if ((Get-Content -LiteralPath (Join-Path $runtime 'version') -Raw).Trim() -cne $metadata.devDependencies.electron) { throw 'Runtime Electron non conforme a la version epinglee.' }
if (!$SkipNativeBuild) {
    & (Join-Path $PSScriptRoot 'build-poc.ps1')
    & (Join-Path $PSScriptRoot 'build-launcher.ps1')
}
foreach ($file in @('.local\poc\myneige-poc.exe','.local\launcher\MyNEIGE.exe')) {
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $root $file))
    if ($version.ProductVersion -cne $metadata.version) { throw "Binaire obsolete : $file" }
}
New-Item -ItemType Directory -Path $dist -Force | Out-Null
if (Test-Path -LiteralPath $payload) {
    Assert-PlainTree $payload
    if (!(Test-Path -LiteralPath (Join-Path $payload 'distribution.json'))) { throw 'Refus de remplacer un dossier non identifie comme construction MyNEIGE.' }
    $old = Get-Content -LiteralPath (Join-Path $payload 'distribution.json') -Raw | ConvertFrom-Json
    if ($old.product -cne 'MyNEIGE' -or $old.version -cne $metadata.version) { throw 'Dossier de construction existant incompatible.' }
    # The resolved target above is a named direct child of this repository's dist.
    Remove-Item -LiteralPath $payload -Recurse -Force
}
New-Item -ItemType Directory -Path $payload -Force | Out-Null
foreach ($directory in @('bin','resources','scripts')) { New-Item -ItemType Directory -Path (Join-Path $payload $directory) | Out-Null }
Copy-Item -LiteralPath $runtime -Destination (Join-Path $payload 'resources\runtime') -Recurse
foreach ($directory in @('src','assets')) { Copy-Item -LiteralPath (Join-Path $root $directory) -Destination (Join-Path $payload $directory) -Recurse }
Copy-Item -LiteralPath (Join-Path $root '.local\poc\myneige-poc.exe') -Destination (Join-Path $payload 'bin\myneige-controller.exe')
Copy-Item -LiteralPath (Join-Path $root '.local\launcher\MyNEIGE.exe') -Destination (Join-Path $payload 'MyNEIGE.exe')
foreach ($file in @('LICENSE','VPN_Universite_Avignon.ovpn')) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $payload }
foreach ($file in @('distribution-common.ps1','launch-distribution.ps1','run-distribution-worker.ps1',
    'openvpn-setup.ps1','openvpn-prerequisites.ps1','openvpn-driver-store.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $payload 'scripts')
}
$appMetadata = [ordered]@{ name = $metadata.name; version = $metadata.version; revision = $metadata.revision; description = $metadata.description;
    author = $metadata.author; license = $metadata.license; homepage = $metadata.homepage; type = 'commonjs'; main = 'src/main/index.js' }
[IO.File]::WriteAllText((Join-Path $payload 'package.json'), ($appMetadata | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $root 'docs\ALPHA_TESTER.md') -Destination (Join-Path $payload 'LIRE-MOI.md')
Copy-Item -LiteralPath (Join-Path $root 'docs\UPDATES.md') -Destination $payload
$notices = "MyNEIGE $($metadata.version) - Matra DevProd`r`nApache-2.0 : LICENSE`r`n`r`nElectron $($metadata.devDependencies.electron) : resources/runtime/LICENSE`r`nChromium et composants embarques : resources/runtime/LICENSES.chromium.html`r`n`r`nOpenVPN Community et TAP ne sont pas redistribues dans ce paquet.`r`nLeur installateur officiel est telecharge et verifie separement, avec votre accord.`r`nLe profil universitaire est embarque pour cette Alpha a la demande du developpeur.`r`n"
[IO.File]::WriteAllText((Join-Path $payload 'THIRD-PARTY-NOTICES.txt'), $notices, [Text.UTF8Encoding]::new($false))
Assert-PlainTree $payload
$files = @(Get-ChildItem -LiteralPath $payload -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($payload.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
})
$manifest = [ordered]@{ schema = 1; product = 'MyNEIGE'; version = $metadata.version; architecture = 'x64';
    minimumWindowsBuild = 22000; electronVersion = $metadata.devDependencies.electron; signed = $false; files = $files }
[IO.File]::WriteAllText((Join-Path $payload 'distribution.json'), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
$null = Test-DistributionPayload $payload
# Validate the actual shipped public profile without starting a tunnel.
& (Join-Path $payload 'bin\myneige-controller.exe') inspect --profile (Join-Path $payload 'VPN_Universite_Avignon.ovpn')
if ($LASTEXITCODE -ne 0) { throw 'Validation native du profil embarque echouee.' }
$zip = Join-Path $dist ($name + '-portable.zip')
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($payload, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
$artifacts = @($zip)
if (!$SkipInstaller) {
    if (!$NsisPath) {
        $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
        if ($command) { $NsisPath = $command.Source }
        else { $NsisPath = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe' }
    }
    if (!(Test-Path -LiteralPath $NsisPath)) { throw 'NSIS absent : installer NSIS ou passer -NsisPath.' }
    $deleteInclude = Join-Path $root '.local\launcher\uninstall-files.nsh'
    $verifyDeleteInclude = Join-Path $root '.local\launcher\verify-uninstall-files.nsh'
    $deleteLines = @(Get-ChildItem -LiteralPath $payload -Recurse -File | ForEach-Object {
        'Delete "$INSTDIR\' + $_.FullName.Substring($payload.Length + 1) + '"'
    })
    $deleteLines += @(Get-ChildItem -LiteralPath $payload -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
        'RMDir "$INSTDIR\' + $_.FullName.Substring($payload.Length + 1) + '"'
    })
    [IO.File]::WriteAllLines($deleteInclude, $deleteLines, [Text.UTF8Encoding]::new($false))
    $verifyLines = @(Get-ChildItem -LiteralPath $payload -Recurse -File | ForEach-Object {
        'IfFileExists "$INSTDIR\' + $_.FullName.Substring($payload.Length + 1) + '" 0 +4'
        '  SetErrorLevel 1'
        '  MessageBox MB_OK|MB_ICONSTOP "Un fichier MyNEIGE ne peut pas etre supprime. Fermez les programmes qui le retiennent puis recommencez." /SD IDOK'
        '  Abort'
    })
    [IO.File]::WriteAllLines($verifyDeleteInclude, $verifyLines, [Text.UTF8Encoding]::new($false))
    $installer = Join-Path $dist ($name + '-setup.exe')
    & $NsisPath /INPUTCHARSET UTF8 /V3 "/DAPP_VERSION=$($metadata.version)" "/DWIN_VERSION=$windowsVersion" "/DPAYLOAD=$payload" "/DOUTPUT=$installer" "/DDELETE_INCLUDE=$deleteInclude" "/DVERIFY_DELETE_INCLUDE=$verifyDeleteInclude" (Join-Path $root 'packaging\windows\installer.nsi')
    if ($LASTEXITCODE -ne 0) { throw "Compilation NSIS echouee ($LASTEXITCODE)." }
    $artifacts += $installer
}
$hashes = @($artifacts | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash + '  ' + [IO.Path]::GetFileName($_) })
[IO.File]::WriteAllLines((Join-Path $dist ($name + '-SHA256SUMS.txt')), $hashes, [Text.UTF8Encoding]::new($false))
$artifacts | Write-Output
