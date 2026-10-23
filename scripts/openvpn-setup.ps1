[CmdletBinding()]
param([switch]$Install, [switch]$Ensure, [switch]$CheckOnly, [switch]$VerifyOnly,
      [switch]$InstallWorker, [string]$Package)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$filename = 'OpenVPN-2.7.8-I001-amd64.msi'
$expectedHash = '1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49'
$binary = Join-Path $repoRoot '.local\poc\myneige-poc.exe'
function Test-OfficialPackage([string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Empreinte OpenVPN differente du paquet officiel qualifie.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -ne 'OpenVPN Inc.') { throw 'Signature ou editeur du MSI OpenVPN non valide.' }
}
function Find-CompatibleOpenVpn {
    if (!(Test-Path -LiteralPath $binary)) { throw 'Compiler le pilote avant de preparer OpenVPN.' }
    $candidates = @((Join-Path $env:ProgramFiles 'OpenVPN\bin\openvpn.exe'))
    if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'OpenVPN\bin\openvpn.exe' }
    $registered = @()
    foreach ($registry in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        $registered += @(Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'OpenVPN*' })
    }
    foreach ($entry in $registered) { if ($entry.InstallLocation) { $candidates += Join-Path $entry.InstallLocation 'bin\openvpn.exe' } }
    $existing = @($candidates | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    foreach ($candidate in $existing) {
        $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $null = & $binary openvpn-check --openvpn $candidate 2>&1
        $code = $LASTEXITCODE; $ErrorActionPreference = $previous
        if ($code -eq 0 -and (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\drivers\tap0901.sys') -PathType Leaf)) { return $candidate }
    }
    if ($existing.Count -or $registered.Count) { throw 'Une installation OpenVPN existe mais ne correspond pas au moteur Community signe et a tapctl attendus. Elle ne sera pas modifiee automatiquement.' }
    return $null
}
if ($VerifyOnly) {
    if (!$Package) { throw 'Paquet a verifier manquant.' }
    Test-OfficialPackage $Package; Write-Output 'OPENVPN_PACKAGE_VERIFIED'; exit 0
}
if ($InstallWorker) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (!([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Installation : elevation requise.' }
    if (Find-CompatibleOpenVpn) { Write-Output 'OPENVPN_ALREADY_COMPATIBLE'; exit 0 }
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
        if (Find-CompatibleOpenVpn) { Write-Output 'OPENVPN_ALREADY_COMPATIBLE'; exit 0 }
        $arguments = @('/i',('"'+$trusted+'"'),'/qn','/norestart','ADDLOCAL=OpenVPN,Drivers,Drivers.TAPWindows6',
            '/L*v',('"'+(Join-Path $stage 'installation.log')+'"'))
        $installer = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -WindowStyle Hidden -PassThru -ArgumentList $arguments
        $installer.WaitForExit()
        if ($installer.ExitCode -notin @(0,3010)) { throw "Installation OpenVPN echouee (code $($installer.ExitCode)). Diagnostic protege : $stage" }
        if (!(Find-CompatibleOpenVpn)) { throw 'Moteur ou tapctl absent apres installation.' }
        Write-Output 'OPENVPN_INSTALLED'
        if ($installer.ExitCode -eq 3010) { Write-Output 'OPENVPN_REBOOT_REQUIRED'; exit 3010 }
    } finally {
        # Only this verified copy is removed. Keep the protected installer log.
        if (Test-Path -LiteralPath $trusted) { Remove-Item -LiteralPath $trusted }
    }
    exit 0
}
if ($Ensure -or $CheckOnly -or $Install) {
    $compatible = Find-CompatibleOpenVpn
    if ($compatible) { Write-Output $compatible; exit 0 }
    if ($CheckOnly) { Write-Output 'OPENVPN_MISSING'; exit 4 }
}
$architecture = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE
if ($architecture -ne 'AMD64') { throw 'Ce pilote qualifie uniquement OpenVPN Windows x64.' }
if ($Ensure) {
    Add-Type -AssemblyName System.Windows.Forms
    $choice = [Windows.Forms.MessageBox]::Show("OpenVPN Community est necessaire et n'est pas installe. MyNEIGE peut telecharger le paquet officiel verifie puis installer le moteur et le pilote TAP avec une demande UAC. Le telechargement utilise votre connexion habituelle, avant le VPN. Continuer ?", 'MyNEIGE - Preparer OpenVPN', 'YesNo', 'Information')
    if ($choice -ne [Windows.Forms.DialogResult]::Yes) { throw 'Preparation OpenVPN annulee. Aucun identifiant universitaire demande.' }
}
$downloadDirectory = Join-Path $repoRoot '.local\downloads'
New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
if (!$Package) {
    $Package = Join-Path $downloadDirectory $filename
    if (!(Test-Path -LiteralPath $Package)) {
        $partial = Join-Path $downloadDirectory ($filename + '.' + [Guid]::NewGuid().ToString('N') + '.part')
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "https://swupdate.openvpn.org/community/releases/$filename" -MaximumRedirection 0 -TimeoutSec 120 -OutFile $partial
            Test-OfficialPackage $partial
            Move-Item -LiteralPath $partial -Destination $Package
        } finally { if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial } }
    }
}
Test-OfficialPackage $Package
Write-Output 'OPENVPN_PACKAGE_VERIFIED'
if (!$Ensure -and !$Install) { Write-Output 'Aucune installation. Utiliser -Install pour installer avec UAC.'; exit 0 }
$worker = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -WorkingDirectory $repoRoot -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-InstallWorker','-Package',('"'+$Package+'"'))
$worker.WaitForExit()
if ($worker.ExitCode -eq 3010) {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show('OpenVPN est installe. Redemarrez Windows avant de lancer le pilote.', 'MyNEIGE', 'OK', 'Information') | Out-Null
    exit 3010
}
if ($worker.ExitCode -ne 0) { throw "Installation OpenVPN non terminee (code $($worker.ExitCode))." }
$compatible = Find-CompatibleOpenVpn
if (!$compatible) { throw 'Verification finale OpenVPN echouee.' }
Write-Output $compatible
