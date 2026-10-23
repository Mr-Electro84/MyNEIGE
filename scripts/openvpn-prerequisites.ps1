# Shared decisions and orchestration. All network, UI and installer effects are
# supplied by the caller so the missing/incomplete paths can be tested safely.
function Get-OpenVpnDecision {
    param([string[]]$Existing = @(), [string[]]$Validated = @(), [string[]]$Partial = @(), [object[]]$Registered = @(), [bool]$TapReady)
    if ($Validated.Count -and $TapReady) {
        return [pscustomobject]@{ State = 'Ready'; Path = $Validated[0]; Message = '' }
    }
    if (@($Existing | Where-Object { $_ -notin $Validated -and $_ -notin $Partial }).Count) {
        return [pscustomobject]@{ State = 'Unsupported'; Path = ''; Message = 'Des fichiers OpenVPN existent, mais leur version ou leur signature ne correspond pas au moteur Community attendu. Aucune installation existante ne sera remplacee automatiquement.' }
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
    if ($State.State -eq 'Ready') { return [pscustomobject]@{ Status = 'Ready'; Path = $State.Path; Code = 0 } }
    if ($State.State -eq 'Unsupported') { throw $State.Message }
    if ($Architecture -ne 'X64') { throw "Installation automatique disponible pour Windows x64 uniquement (architecture detectee : $Architecture)." }
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
