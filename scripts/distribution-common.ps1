# Shared by the installed launcher, its worker and distribution tests.
# npm or a native intermediary can inherit PowerShell 7's PSModulePath. Import
# the inbox utility module from the interpreter actually running this script.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
function Assert-PlainTree([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Lien ou repertoire redirige refuse : $Path" }
    if ($item.PSIsContainer) { foreach ($child in Get-ChildItem -LiteralPath $Path -Force) { Assert-PlainTree $child.FullName } }
}
function Get-PayloadPath([string]$Root, [string]$Relative) {
    if (!$Relative -or $Relative.Contains('\') -or $Relative.Contains(':') -or $Relative -match '(^|/)\.\.?(/|$)' -or
        [IO.Path]::IsPathRooted($Relative)) { throw 'Chemin de paquet invalide.' }
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (!$resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Chemin hors du paquet refuse.' }
    return $resolved
}
function Test-DistributionPayload([string]$Root) {
    Assert-PlainTree $Root
    if (Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object { $_.Extension -in @('.ovpn','.dpapi') }) {
        throw 'Profil personnel interdit dans le paquet.'
    }
    $checker = Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\myneige-controller.exe'
    if (!(Test-Path -LiteralPath $checker)) { $checker = Join-Path (Split-Path -Parent $PSScriptRoot) '.local\poc\myneige-poc.exe' }
    if (Test-Path -LiteralPath $checker) {
        $previous = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $output = & $checker payload-check --project-root $Root 2>&1
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previous }
        if ($code -ne 0 -or (@($output) -join "`n") -notmatch '^PAYLOAD_VALIDATED files=\d+$') {
            throw ('Verification du paquet refusee : ' + (@($output | ForEach-Object { $_.ToString() }) -join "`n"))
        }
        return Get-Content -LiteralPath (Join-Path $Root 'distribution.json') -Raw | ConvertFrom-Json
    }
    Assert-PlainTree $Root
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'distribution.json') -Raw | ConvertFrom-Json
    if ($manifest.product -cne 'MyNEIGE' -or $manifest.schema -ne 1 -or $manifest.architecture -cne 'x64' -or !$manifest.files.Count) {
        throw 'Manifeste de distribution incompatible.'
    }
    $seen = @{}
    foreach ($entry in $manifest.files) {
        $file = Get-PayloadPath $Root $entry.path
        if ($seen.ContainsKey($entry.path) -or $entry.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Entree de manifeste invalide.' }
        $seen[$entry.path] = $true
        if (!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $entry.sha256) {
            throw "Fichier du programme manquant ou altere : $($entry.path). Reinstallez MyNEIGE ou extrayez a nouveau l'archive complete."
        }
    }
    foreach ($required in @('MyNEIGE.exe','bin/myneige-controller.exe','resources/runtime/electron.exe',
        'src/main/index.js','src/main/about.js','package.json','LICENSE',
        'scripts/launch-distribution.ps1','scripts/run-distribution-worker.ps1','scripts/openvpn-setup.ps1')) {
        if (!$seen.ContainsKey($required)) { throw "Fichier obligatoire absent du manifeste : $required" }
    }
    $metadata = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
    if ($metadata.version -cne $manifest.version) { throw 'Versions du manifeste et du programme incoherentes.' }
    return $manifest
}
function Test-MyneigeSessionActive {
    try {
        $mutex = [Threading.Mutex]::OpenExisting('Global\MyNEIGE-PoC-Session-v1')
        $mutex.Dispose()
        return $true
    } catch [Threading.WaitHandleCannotBeOpenedException] { return $false }
    catch [UnauthorizedAccessException] { return $true }
}
