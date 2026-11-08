# Shared decisions and orchestration. All network, UI and installer effects are
# supplied by the caller so the missing/incomplete paths can be tested safely.
function Get-OpenVpnPackageReference([string]$Architecture) {
    switch ($Architecture) {
        'X64' { return [pscustomobject]@{ FileName = 'OpenVPN-2.7.8-I001-amd64.msi'; Sha256 = '1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49'; Machine = 0x8664 } }
        'Arm64' { return [pscustomobject]@{ FileName = 'OpenVPN-2.7.8-I001-arm64.msi'; Sha256 = '6FC0E8899CC5275EE297FB837BC84AA2BC49F8EF96D7AD93EE3FEE1E7163A25C'; Machine = 0xAA64 } }
        default { throw "OpenVPN requiert Windows x64 ou ARM64 (architecture detectee : $Architecture)." }
    }
}
function Test-OfficialOpenVpnPackage([string]$Path, [string]$Architecture) {
    $reference = Get-OpenVpnPackageReference $Architecture
    if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $reference.Sha256) {
        throw 'Empreinte OpenVPN differente du paquet officiel de cette architecture.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -ne 'OpenVPN Inc.') {
        throw 'Signature ou editeur du MSI OpenVPN non valide.'
    }
}
function Test-OpenVpnToolArchitecture([string]$Path, [string]$Architecture) {
    $reference = Get-OpenVpnPackageReference $Architecture
    try { return (Get-MyneigePeMachine $Path) -eq $reference.Machine }
    catch { return $false }
}
function Get-OpenVpnRegistryInventory {
    # Les vues explicites retrouvent aussi une installation ARM64 depuis PowerShell x86.
    $candidates = @(); $registered = @()
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
        try {
            $configuration = $base.OpenSubKey('SOFTWARE\OpenVPN')
            if ($configuration) {
                try {
                    $exe = $configuration.GetValue('exe_path'); $bin = $configuration.GetValue('bin_dir')
                    if ($exe) { $candidates += [string]$exe }
                    if ($bin) { $candidates += Join-Path $bin 'openvpn.exe' }
                } finally { $configuration.Dispose() }
            }
            $uninstall = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
            if ($uninstall) {
                try {
                    foreach ($name in $uninstall.GetSubKeyNames()) {
                        # Une application tierce peut proteger sa propre cle de desinstallation.
                        try { $entry = $uninstall.OpenSubKey($name) }
                        catch [System.Security.SecurityException] { continue }
                        catch [System.UnauthorizedAccessException] { continue }
                        if (!$entry) { continue }
                        try {
                            $displayName = $entry.GetValue('DisplayName')
                            if ($displayName -like 'OpenVPN*') {
                                $registered += [pscustomobject]@{ DisplayName = $displayName; InstallLocation = $entry.GetValue('InstallLocation') }
                            }
                        } finally { $entry.Dispose() }
                    }
                } finally { $uninstall.Dispose() }
            }
        } finally { $base.Dispose() }
    }
    return [pscustomobject]@{ Candidates = $candidates; Registered = $registered }
}
function Test-OpenVpnMsiRegistered([string]$Product) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
        try {
            $entry = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\' + $Product)
            if ($entry) { $entry.Dispose(); return $true }
        } finally { $base.Dispose() }
    }
    return $false
}
function Invoke-OpenVpnNativeCommand {
    param([string]$Binary, [string[]]$Arguments)
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $Binary @Arguments 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    # Windows PowerShell wraps native stderr in ErrorRecord objects. Preserve
    # the actual message instead of formatting the PowerShell call-site prefix.
    $message = (@($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    return [pscustomobject]@{ Code = $code; Output = $message }
}
function Confirm-OpenVpnNativeChecker {
    param([scriptblock]$Probe, [scriptblock]$Build, [bool]$AllowBuild = $false)
    $result = & $Probe
    if ($result.Code -eq 0 -and $result.Output -ceq 'MYNEIGE_SETUP_PROTOCOL=1') { return }
    if ($AllowBuild) {
        & $Build | Out-Host
        $result = & $Probe
        if ($result.Code -eq 0 -and $result.Output -ceq 'MYNEIGE_SETUP_PROTOCOL=1') { return }
    }
    throw 'Pilote natif MyNEIGE absent, obsolete ou incompatible avec les scripts. Ce resultat ne permet pas de verifier OpenVPN. Fermez MyNEIGE puis lancez npm run poc:build avant de reessayer. Visual Studio Build Tools C++ et Windows SDK sont requis pour compiler le pilote.'
}
function Test-OpenVpnNativeResult {
    param($Result)
    if ($Result.Code -eq 0 -and $Result.Output -ceq 'OPENVPN_COMPATIBLE') { return $true }
    if ($Result.Code -eq 1 -and $Result.Output -cmatch '^ERROR: ') { return $false }
    throw ('Le verificateur natif MyNEIGE ne retourne pas le resultat attendu (code ' + $Result.Code + '). Recompilez le pilote avec npm run poc:build. La signature OpenVPN ne peut pas etre evaluee.')
}
function Get-OpenVpnDecision {
    param([string[]]$Existing = @(), [string[]]$Validated = @(), [string[]]$Partial = @(), [object[]]$Registered = @(), [bool]$TapReady)
    if ($Validated.Count -and $TapReady) {
        return [pscustomobject]@{ State = 'Ready'; Path = $Validated[0]; Message = '' }
    }
    if (@($Existing | Where-Object { $_ -notin $Validated -and $_ -notin $Partial }).Count) {
        return [pscustomobject]@{ State = 'Unsupported'; Path = ''; Message = 'Des fichiers OpenVPN existent, mais leur architecture, version ou signature ne correspond pas au moteur Community attendu. Sur ARM64, installer OpenVPN Community ARM64 avec TAP. Aucune installation existante ne sera remplacee automatiquement.' }
    }
    $community = @($Registered | Where-Object { $_.DisplayName -notlike 'OpenVPN Connect*' })
    if ($Validated.Count -or $Partial.Count -or $community.Count) {
        return [pscustomobject]@{ State = 'Incomplete'; Path = ''; Message = 'OpenVPN Community est incomplet : le moteur, tapctl ou le pilote TAP manque. MyNEIGE peut ouvrir une installation ou reparation du paquet officiel verifie.' }
    }
    return [pscustomobject]@{ State = 'Missing'; Path = ''; Message = 'OpenVPN Community est absent. MyNEIGE peut telecharger et installer le moteur et le pilote TAP.' }
}
function Invoke-OpenVpnPreparation {
    param($State, [string]$Architecture, [scriptblock]$Confirm, [scriptblock]$Download,
          [scriptblock]$InstallPackage, [scriptblock]$Recheck)
    $null = Get-OpenVpnPackageReference $Architecture
    if ($State.State -eq 'Ready') { return [pscustomobject]@{ Status = 'Ready'; Path = $State.Path; Code = 0 } }
    if ($State.State -eq 'Unsupported') { throw $State.Message }
    if (!(& $Confirm $State)) { return [pscustomobject]@{ Status = 'Cancelled'; Path = ''; Code = 2 } }
    $package = & $Download
    $code = & $InstallPackage $package
    if ($code -eq 1602) { return [pscustomobject]@{ Status = 'Cancelled'; Path = ''; Code = 2 } }
    if ($code -eq 3010) { return [pscustomobject]@{ Status = 'RebootRequired'; Path = ''; Code = 3010 } }
    if ($code -ne 0) { throw "Installation OpenVPN non terminee (code $code)." }
    $after = & $Recheck
    if ($after.State -ne 'Ready') { throw ('Le MSI est termine, mais le controle final echoue. ' + $after.Message) }
    return [pscustomobject]@{ Status = 'Ready'; Path = $after.Path; Code = 0 }
}
function Get-OpenVpnMsiProductCode([string]$Path) {
    $database = $null; $view = $null; $record = $null
    $msi = New-Object -ComObject WindowsInstaller.Installer
    try {
        $database = $msi.OpenDatabase($Path, 0)
        $view = $database.OpenView("SELECT Value FROM Property WHERE Property = 'ProductCode'")
        $null = $view.Execute(); $record = $view.Fetch(); $product = $record.StringData(1)
        if ($product -notmatch '^\{[A-Fa-f0-9-]{36}\}$') { throw 'Identite du produit MSI invalide.' }
        return $product
    } finally {
        foreach ($object in @($record,$view,$database,$msi)) { if ($null -ne $object) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) | Out-Null } }
    }
}
