[CmdletBinding()]
param([switch]$CheckOnly, [switch]$BrowserTest, [switch]$ForgetCredentials, [switch]$ResetUserData)
$ErrorActionPreference = 'Stop'
$startupClock = [Diagnostics.Stopwatch]::StartNew()
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MyNEIGE'
$logDirectory = Join-Path $data 'logs'
$diagnostic = ''
function Show-MyneigeMessage([string]$Message, [string]$Icon = 'Warning') {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($Message, 'MyNEIGE Alpha', 'OK', $Icon) | Out-Null
}
try {
    . (Join-Path $PSScriptRoot 'distribution-common.ps1')
    if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64' -or [Environment]::OSVersion.Version.Build -lt 22000) {
        throw 'Cette Alpha requiert Windows 11 x64.'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $admin = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($admin -and !$CheckOnly) { throw "Lancez MyNEIGE normalement, sans executer le lanceur en tant qu'administrateur. Seul le controleur demandera une elevation UAC." }
    $manifest = Test-DistributionPayload $root
    Write-Output ('STARTUP_PAYLOAD elapsed_ms=' + $startupClock.ElapsedMilliseconds)
    $binary = Join-Path $root 'bin\myneige-controller.exe'
    if ($ForgetCredentials -or $ResetUserData) {
        if (Test-MyneigeSessionActive) { throw 'Fermez la session MyNEIGE avant de supprimer les donnees.' }
        if ($ResetUserData) {
            Add-Type -AssemblyName System.Windows.Forms
            if ([Windows.Forms.MessageBox]::Show('Supprimer les identifiants memorises, le cache du navigateur, les diagnostics et les telechargements de preparation OpenVPN de ce compte ? Vos fichiers telecharges depuis les sites universitaires sont conserves.', 'MyNEIGE - Effacer les donnees locales', 'YesNo', 'Warning') -ne 'Yes') { exit 2 }
            if (Test-Path -LiteralPath $data) {
                # Inspect every descendant before deleting only these owned paths.
                Assert-PlainTree $data
                foreach ($name in @('credentials.dpapi','browser-data','logs','downloads')) {
                    $target = [IO.Path]::GetFullPath((Join-Path $data $name))
                    if (!$target.StartsWith(([IO.Path]::GetFullPath($data) + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Suppression hors des donnees MyNEIGE refusee.' }
                    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
                }
            }
        } else { & $binary vault-forget; if ($LASTEXITCODE -ne 0) { throw 'Suppression des identifiants impossible.' } }
        Show-MyneigeMessage 'Les donnees selectionnees ont ete supprimees.' 'Information'
        exit 0
    }
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $diagnostic = Join-Path $logDirectory ('preparation-' + [Guid]::NewGuid().ToString('N') + '.txt')
    $resultFile = [IO.Path]::ChangeExtension($diagnostic, '.json')
    $setupArguments = @{ ResultFile = $resultFile }
    if ($CheckOnly) { $setupArguments.CheckOnly = $true }
    elseif ($BrowserTest) { $setupArguments.Diagnose = $true }
    else { $setupArguments.Ensure = $true }
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    # A child script has its own scope; its exit code returns here. No second PowerShell is needed.
    & (Join-Path $PSScriptRoot 'openvpn-setup.ps1') @setupArguments *> $diagnostic
    $setupCode = $LASTEXITCODE; $ErrorActionPreference = $previous
    Write-Output ('STARTUP_PREREQUISITES elapsed_ms=' + $startupClock.ElapsedMilliseconds)
    if ($CheckOnly) {
        if (!(Test-Path -LiteralPath $resultFile)) { throw 'Resultat du controle OpenVPN manquant.' }
        $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
        Write-Output "MYNEIGE_PAYLOAD_VALID version=$($manifest.version) files=$($manifest.files.Count) openvpn=$($result.Status)"
        exit $setupCode
    }
    if (!$BrowserTest) {
        if (!(Test-Path -LiteralPath $resultFile)) { throw 'La preparation OpenVPN ne retourne aucun resultat.' }
        $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
        if ($result.Status -in @('Cancelled','RebootRequired')) { Show-MyneigeMessage $result.Message 'Information'; exit $result.Code }
        if ($setupCode -ne 0 -or $result.Status -ne 'Ready') { throw $result.Message }
    }
    $logName = 'session-' + [Guid]::NewGuid().ToString('N') + '.txt'
    $command = if ($BrowserTest) { 'distribution-test' } else { 'distribution-browse' }
    $arguments = @($command,'--project-root',('"' + $root + '"'),'--log-name',$logName)
    if (!$BrowserTest) { $arguments += @('--profile',('"' + (Join-Path $root 'VPN_Universite_Avignon.ovpn') + '"'),'--openvpn',('"' + $result.Path + '"')) }
    try {
        $worker = Start-Process -FilePath $binary -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru -WorkingDirectory $root
    } catch {
        if ($_.Exception.NativeErrorCode -eq 1223) { exit 2 }
        throw
    }
    $worker.WaitForExit()
    $protectedLog = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('MyNEIGE-Logs\' + $logName)
    # Only the unelevated launcher copies the sanitized diagnostic into user data.
    if (Test-Path -LiteralPath $protectedLog -PathType Leaf) { Copy-Item -LiteralPath $protectedLog -Destination (Join-Path $logDirectory $logName) }
    if ($worker.ExitCode -ne 0) { throw "La session s'est arretee (code $($worker.ExitCode)). Diagnostic : $protectedLog" }
    if ($BrowserTest) { Write-Output "MYNEIGE_BROWSER_TEST passed log=$protectedLog" }
    exit 0
} catch {
    $message = $_.Exception.Message
    if ($diagnostic) { $message += "`r`nDiagnostic de preparation : $diagnostic" }
    if (!$CheckOnly) { Show-MyneigeMessage $message }
    else { Write-Error $message -ErrorAction Continue }
    exit 1
}
