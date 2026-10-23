[CmdletBinding()]
param([switch]$Install, [switch]$Ensure, [switch]$CheckOnly, [switch]$VerifyOnly,
      [switch]$InstallWorker, [string]$Package, [string]$ResultFile)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$filename = 'OpenVPN-2.7.8-I001-amd64.msi'
$expectedHash = '1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49'
$binary = Join-Path $repoRoot '.local\poc\myneige-poc.exe'
. (Join-Path $PSScriptRoot 'openvpn-prerequisites.ps1')
$script:setupStage = 'Detection'
function Write-SetupResult([string]$Status, [string]$Path, [string]$Message, [int]$Code) {
    if ($ResultFile -and !$InstallWorker) {
        $result = @{ Status = $Status; Path = $Path; Message = $Message; Code = $Code; Stage = $script:setupStage }
        [IO.File]::WriteAllText($ResultFile, ($result | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    }
}
trap {
    $message = $_.Exception.Message
    Write-SetupResult 'Error' '' $message 1
    if ($InstallWorker) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($message, 'MyNEIGE - Installation OpenVPN', 'OK', 'Error') | Out-Null
    }
    Write-Error -Message $message -ErrorAction Continue
    exit 1
}
function Test-OfficialPackage([string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Empreinte OpenVPN differente du paquet officiel qualifie.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -ne 'OpenVPN Inc.') { throw 'Signature ou editeur du MSI OpenVPN non valide.' }
}
function Get-OpenVpnState {
    $candidates = @((Join-Path $env:ProgramFiles 'OpenVPN\bin\openvpn.exe'))
    if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'OpenVPN\bin\openvpn.exe' }
    $registered = @()
    foreach ($registry in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        $registered += @(Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'OpenVPN*' })
    }
    foreach ($entry in $registered) { if ($entry.InstallLocation) { $candidates += Join-Path $entry.InstallLocation 'bin\openvpn.exe' } }
    $existing = @($candidates | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    $validated = @(); $partial = @()
    if ($existing.Count -and !(Test-Path -LiteralPath $binary)) { throw 'Compiler le pilote avant de verifier les fichiers OpenVPN existants.' }
    foreach ($candidate in $existing) {
        if (!(Test-Path -LiteralPath (Join-Path (Split-Path -Parent $candidate) 'tapctl.exe') -PathType Leaf)) {
            $signature = Get-AuthenticodeSignature -LiteralPath $candidate
            $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($candidate)
            if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -in @('OpenVPN Inc.','OpenVPN, Inc.','OpenVPN Inc','OpenVPN Technologies, Inc.') -and
                $version.FileMajorPart -eq 2 -and $version.FileMinorPart -eq 7 -and $version.FileBuildPart -ge 8) { $partial += $candidate }
            continue
        }
        $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $null = & $binary openvpn-check --openvpn $candidate 2>&1
        $code = $LASTEXITCODE; $ErrorActionPreference = $previous
        if ($code -eq 0) { $validated += $candidate }
    }
    $tap = (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\drivers\tap0901.sys') -PathType Leaf) -and
        (Test-Path -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\tap0901')
    return Get-OpenVpnDecision -Existing $existing -Validated $validated -Partial $partial -Registered $registered -TapReady $tap
}
if ($VerifyOnly) {
    $script:setupStage = 'Verification paquet'
    if (!$Package) { throw 'Paquet a verifier manquant.' }
    Test-OfficialPackage $Package; Write-Output 'OPENVPN_PACKAGE_VERIFIED'; exit 0
}
if ($InstallWorker) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (!([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Installation : elevation requise.' }
    $state = Get-OpenVpnState
    if ($state.State -eq 'Ready') { Write-Output 'OPENVPN_ALREADY_COMPATIBLE'; exit 0 }
    if ($state.State -eq 'Unsupported') { throw $state.Message }
    if (!$Package) { throw 'Paquet a installer manquant.' }
    $parent = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'MyNEIGE-Setup'
    if (Test-Path -LiteralPath $parent) {
        if ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Repertoire de preparation redirige refuse.' }
        $owner = (Get-Acl -LiteralPath $parent).GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin @('S-1-5-32-544','S-1-5-18')) { throw 'Proprietaire du repertoire de preparation non administratif.' }
    } else { New-Item -ItemType Directory -Path $parent | Out-Null }
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
    Set-Acl -LiteralPath $parent -AclObject $acl
    $stage = Join-Path $parent ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $trusted = Join-Path $stage $filename
    try {
        Copy-Item -LiteralPath $Package -Destination $trusted
        Test-OfficialPackage $trusted
        $state = Get-OpenVpnState
        if ($state.State -eq 'Ready') { Write-Output 'OPENVPN_ALREADY_COMPATIBLE'; exit 0 }
        if ($state.State -eq 'Unsupported') { throw $state.Message }
        # MSI provides visible progress and error dialogs. No forced restart.
        $arguments = @('/i',('"'+$trusted+'"'),'/qb','/norestart','ADDLOCAL=OpenVPN,Drivers,Drivers.TAPWindows6',
            '/L*v',('"'+(Join-Path $stage 'installation.log')+'"'))
        # Repair only the exact MSI product already registered on this machine.
        # Do not force a repair/upgrade of another OpenVPN release.
        $product = Get-OpenVpnMsiProductCode $trusted
        $sameProduct = (Test-Path -LiteralPath ('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\' + $product)) -or
            (Test-Path -LiteralPath ('HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\' + $product))
        if ($sameProduct) { $arguments += @('REINSTALL=ALL','REINSTALLMODE=vomus') }
        $installer = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -WindowStyle Hidden -PassThru -ArgumentList $arguments
        $installer.WaitForExit()
        if ($installer.ExitCode -notin @(0,3010)) {
            if ($installer.ExitCode -ne 1602) {
                Add-Type -AssemblyName System.Windows.Forms
                [Windows.Forms.MessageBox]::Show("Installation OpenVPN echouee (code $($installer.ExitCode)). Diagnostic protege : $stage", 'MyNEIGE - Installation OpenVPN', 'OK', 'Error') | Out-Null
            }
            exit $installer.ExitCode
        }
        Write-Output 'OPENVPN_INSTALLED'
        if ($installer.ExitCode -eq 3010) { Write-Output 'OPENVPN_REBOOT_REQUIRED'; exit 3010 }
        if ((Get-OpenVpnState).State -ne 'Ready') { throw "Moteur ou pilote TAP absent apres installation. Diagnostic : $stage" }
    } finally {
        # Only this verified copy is removed. Keep the protected installer log.
        if (Test-Path -LiteralPath $trusted) { Remove-Item -LiteralPath $trusted }
    }
    exit 0
}
function Get-VerifiedPackage {
    $script:setupStage = 'Telechargement et verification'
    $downloadDirectory = Join-Path $repoRoot '.local\downloads'
    New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
    $selected = $Package
    if (!$selected) {
        $selected = Join-Path $downloadDirectory $filename
        if (!(Test-Path -LiteralPath $selected)) {
            Write-Host 'MyNEIGE : telechargement du paquet officiel OpenVPN...'
            $partial = Join-Path $downloadDirectory ($filename + '.' + [Guid]::NewGuid().ToString('N') + '.part')
            try {
                Invoke-WebRequest -UseBasicParsing -Uri "https://swupdate.openvpn.org/community/releases/$filename" -MaximumRedirection 0 -TimeoutSec 120 -OutFile $partial
                Test-OfficialPackage $partial
                Move-Item -LiteralPath $partial -Destination $selected
            } finally { if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial } }
        }
    }
    Test-OfficialPackage $selected
    return $selected
}
if ($CheckOnly) {
    $state = Get-OpenVpnState
    $code = @{ Ready = 0; Missing = 4; Incomplete = 5; Unsupported = 6 }[$state.State]
    Write-SetupResult $state.State $state.Path $state.Message $code
    if ($state.State -eq 'Ready') { Write-Output $state.Path } else { Write-Output ('OPENVPN_' + $state.State.ToUpperInvariant()) }
    exit $code
}
# OSArchitecture is an API result, not an optional registry environment value.
$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if (!$Ensure -and !$Install) {
    if ($architecture -ne 'X64') { throw 'Ce pilote qualifie uniquement OpenVPN Windows x64.' }
    $null = Get-VerifiedPackage
    Write-SetupResult 'Downloaded' '' 'Paquet officiel verifie. Aucune installation effectuee.' 0
    Write-Output 'OPENVPN_PACKAGE_VERIFIED'
    exit 0
}
$result = Invoke-OpenVpnPreparation -State (Get-OpenVpnState) -Architecture $architecture -Confirm {
    param($state)
    $script:setupStage = 'Proposition installation'
    if (!$Ensure) { return $true }
    Add-Type -AssemblyName System.Windows.Forms
    $message = $state.Message + "`r`n`r`nInstaller OpenVPN Community depuis MyNEIGE ? Le paquet officiel sera verifie, puis Windows demandera une elevation UAC. Le telechargement utilise votre connexion habituelle, avant le VPN. Aucun redemarrage force."
    return [Windows.Forms.MessageBox]::Show($message, 'MyNEIGE - Installer OpenVPN', 'YesNo', 'Question') -eq [Windows.Forms.DialogResult]::Yes
} -Download { Get-VerifiedPackage } -InstallPackage {
    param($selected)
    $script:setupStage = 'Installation avec UAC'
    Write-Host 'MyNEIGE : paquet verifie. Installation OpenVPN avec UAC...'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    try {
        $worker = Start-Process -FilePath $powershell -Verb RunAs -WindowStyle Hidden -PassThru -WorkingDirectory $repoRoot -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-InstallWorker','-Package',('"'+$selected+'"'))
    } catch {
        if ($_.Exception.NativeErrorCode -eq 1223) { return 1602 }
        throw ('Installation non lancee : elevation impossible. ' + $_.Exception.Message)
    }
    $worker.WaitForExit()
    return $worker.ExitCode
} -Recheck { $script:setupStage = 'Verification finale'; Get-OpenVpnState }
$message = switch ($result.Status) {
    'Cancelled' { 'Installation OpenVPN annulee. Aucun tunnel demarre.' }
    'RebootRequired' { 'OpenVPN est installe. Redemarrez Windows avant de relancer MyNEIGE.' }
    default { 'OpenVPN est pret.' }
}
Write-SetupResult $result.Status $result.Path $message $result.Code
if ($result.Status -eq 'RebootRequired' -and !$ResultFile) {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($message, 'MyNEIGE', 'OK', 'Information') | Out-Null
}
if ($result.Path) { Write-Output $result.Path } else { Write-Output $message }
exit $result.Code
