[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Utiliser les modules de l'interpreteur courant, meme apres un lancement depuis PowerShell 7.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root '.local\poc\myneige-poc.exe'
$fixture = [IO.Path]::GetFullPath((Join-Path $root ('.local\profile-payload-' + [Guid]::NewGuid().ToString('N'))))
if (!$fixture.StartsWith(([IO.Path]::GetFullPath($root).TrimEnd('\') + '\.local\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture hors du projet.' }
$files = @('MyNEIGE.exe','bin/myneige-controller.exe','bin/myneige-vault.exe','resources/runtime/electron.exe','src/main/index.js',
    'src/main/about.js','package.json','LICENSE','scripts/launch-distribution.ps1','scripts/run-distribution-worker.ps1','scripts/openvpn-setup.ps1')
function Assert-PayloadResult([bool]$Expected) {
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        # Les commandes natives mettent a jour la variable globale ; ne pas la masquer localement.
        $global:LASTEXITCODE = $null
        $resultLines = @(& $binary payload-check --project-root $fixture 2>&1)
        $resultCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previous }
    if ($null -eq $resultCode) { throw 'Le controleur ne peut pas etre execute ; ce resultat ne valide pas le test.' }
    $resultText = (@($resultLines | ForEach-Object { $_.ToString() }) -join "`n")
    if ($Expected -and $resultText -notmatch '^PAYLOAD_VALIDATED files=\d+$') { throw 'Acquittement natif absent.' }
    if (!$Expected -and $resultText -notmatch '^ERROR: ') { throw 'Refus natif attendu absent.' }
    if (($resultCode -eq 0) -ne $Expected) { throw 'Resultat inattendu du controle de paquet fictif.' }
}
if (!(Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'Controleur natif indisponible ; aucun test de paquet execute.' }
try {
    foreach ($file in $files) {
        $target = Join-Path $fixture $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        # Fichiers texte factices : aucun exécutable, runtime ou standalone produit.
        [IO.File]::WriteAllText($target, 'fixture-only')
    }
    [IO.File]::WriteAllText((Join-Path $fixture 'package.json'), '{"version":"fixture"}')
    $entries = @($files | ForEach-Object { @{ path=$_; sha256=(Get-FileHash -LiteralPath (Join-Path $fixture $_)).Hash } })
    $manifest = @{ product='MyNEIGE'; schema=1; architecture='x64'; version='fixture'; files=$entries }
    [IO.File]::WriteAllText((Join-Path $fixture 'distribution.json'), ($manifest | ConvertTo-Json -Depth 5))
    Assert-PayloadResult $true
    # Un coffre absent du manifeste doit être refusé, même si les autres fichiers sont valides.
    $withoutVault = $entries | Where-Object { $_.path -ne 'bin/myneige-vault.exe' }
    $manifest.files = @($withoutVault)
    [IO.File]::WriteAllText((Join-Path $fixture 'distribution.json'), ($manifest | ConvertTo-Json -Depth 5))
    Assert-PayloadResult $false
    $manifest.files = $entries
    [IO.File]::WriteAllText((Join-Path $fixture 'distribution.json'), ($manifest | ConvertTo-Json -Depth 5))
    foreach ($extension in @('.ovpn','.dpapi')) {
        $personal = Join-Path $fixture ('forbidden' + $extension)
        [IO.File]::WriteAllText($personal, 'synthetic data, not a user profile')
        Assert-PayloadResult $false
        Remove-Item -LiteralPath $personal
    }
    [IO.File]::WriteAllText((Join-Path $fixture 'LICENSE'), 'altered fixture')
    Assert-PayloadResult $false
    Write-Output 'PROFILE_PACKAGING_TEST checks=5 synthetic_files_only=true no_distribution_built=true'
} finally {
    if (Test-Path -LiteralPath $fixture) {
        $resolved = (Resolve-Path -LiteralPath $fixture).Path
        if ($resolved -ne $fixture -or !$resolved.StartsWith(([IO.Path]::GetFullPath($root).TrimEnd('\') + '\.local\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Nettoyage hors fixture refuse.' }
        if (Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Lien inattendu dans la fixture.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
