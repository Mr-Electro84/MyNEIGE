[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-platform.ps1')
. (Join-Path $PSScriptRoot 'openvpn-prerequisites.ps1')
$checks = 0
function Assert-Platform([bool]$Ok, [string]$Message) { if (!$Ok) { throw $Message }; $script:checks++ }
function Assert-PlatformReject([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    Assert-Platform $rejected $Message
}
$native = Get-MyneigeNativeArchitecture
Assert-Platform ($native -in @('X64','Arm64')) 'Architecture native introuvable.'
Assert-Platform ([MyNeige.NativePlatform]::ArchitectureName(0xAA64) -ceq 'Arm64') 'Un hote ARM64 doit rester ARM64 sous emulation.'
Assert-Platform ([MyNeige.NativePlatform]::ArchitectureName(0x8664) -ceq 'X64') 'Regression de la detection AMD64.'
Assert-PlatformReject { [MyNeige.NativePlatform]::ArchitectureName(0x014c) } 'Windows x86 doit etre refuse.'
Assert-PlatformReject { [MyNeige.NativePlatform]::ArchitectureName(0) } 'Une architecture inconnue doit etre refusee.'
foreach ($architecture in @('X64','Arm64')) {
    Assert-MyneigeHost -Architecture $architecture -WindowsBuild 22000
    $checks++
    Assert-PlatformReject { Assert-MyneigeHost -Architecture $architecture -WindowsBuild 19045 } 'Windows 10 doit etre refuse.'
}
Assert-PlatformReject { Assert-MyneigeHost -Architecture 'X86' -WindowsBuild 26200 } 'Windows x86 doit etre refuse au lancement.'
$x64 = Get-OpenVpnPackageReference 'X64'; $arm64 = Get-OpenVpnPackageReference 'Arm64'
Assert-Platform ($x64.FileName -eq 'OpenVPN-2.7.8-I001-amd64.msi' -and $arm64.FileName -eq 'OpenVPN-2.7.8-I001-arm64.msi') 'Mauvaise selection du MSI natif.'
Assert-Platform ($x64.Sha256 -ne $arm64.Sha256 -and $arm64.Sha256 -match '^[A-F0-9]{64}$') 'Les deux MSI doivent avoir leur propre empreinte.'
Assert-PlatformReject { Get-OpenVpnPackageReference 'X86' } 'Aucun MSI ne doit etre choisi pour une architecture non prise en charge.'
$systemExe = Get-MyneigeSystemExecutable 'msiexec.exe'
Assert-Platform ((Get-MyneigePeMachine $systemExe) -eq (Get-OpenVpnPackageReference $native).Machine) 'Le MSI doit etre execute par msiexec natif.'
$root = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $root ('.local\platform-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$fixture = Join-Path $fixtureRoot 'header.bin'
function Save-Header([int]$Machine, [int]$Offset = 64, [uint32]$Signature = 0x00004550) {
    $bytes = New-Object byte[] 128
    [BitConverter]::GetBytes([uint16]0x5A4D).CopyTo($bytes,0)
    [BitConverter]::GetBytes($Offset).CopyTo($bytes,0x3c)
    [BitConverter]::GetBytes($Signature).CopyTo($bytes,64)
    [BitConverter]::GetBytes([uint16]$Machine).CopyTo($bytes,68)
    [IO.File]::WriteAllBytes($fixture,$bytes)
}
try {
    foreach ($reference in @($x64,$arm64)) {
        Save-Header $reference.Machine
        Assert-Platform ((Get-MyneigePeMachine $fixture) -eq $reference.Machine) 'Architecture PE incorrecte.'
        $architecture = if ($reference.Machine -eq 0xAA64) { 'Arm64' } else { 'X64' }
        $other = if ($architecture -eq 'Arm64') { 'X64' } else { 'Arm64' }
        Assert-Platform (Test-OpenVpnToolArchitecture $fixture $architecture) 'Le moteur natif doit etre reconnu.'
        Assert-Platform (!(Test-OpenVpnToolArchitecture $fixture $other)) 'Un moteur ou tapctl emule ne doit pas satisfaire le prerequis natif.'
    }
    Assert-PlatformReject { Assert-MyneigeX64Runtime $fixture } 'Electron ARM64 doit etre refuse pour cette cible x64.'
    Save-Header 0x8664
    Assert-MyneigeX64Runtime $fixture; $checks++
    foreach ($offset in @(-1,0,120,[int]::MaxValue)) {
        Save-Header 0x8664 -Offset $offset
        Assert-PlatformReject { Get-MyneigePeMachine $fixture } 'Une adresse PE hors limites doit etre refusee.'
    }
    Save-Header 0x8664 -Signature 0
    Assert-PlatformReject { Get-MyneigePeMachine $fixture } 'Une fausse signature PE doit etre refusee.'
    [IO.File]::WriteAllText($fixture,'fichier tronque')
    Assert-PlatformReject { Get-MyneigePeMachine $fixture } 'Un fichier tronque doit etre refuse.'
    Assert-Platform (!(Test-OpenVpnToolArchitecture $fixture 'Arm64')) 'Un fichier invalide ne doit pas etre un moteur ARM64.'
    Assert-PlatformReject { Test-OfficialOpenVpnPackage $fixture 'Arm64' } 'Un faux MSI ARM64 doit etre refuse.'
    Assert-MyneigeX64Runtime (Join-Path $root 'node_modules\electron\dist\electron.exe'); $checks++
} finally {
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture }
    Remove-Item -LiteralPath $fixtureRoot
}
Write-Output "WINDOWS_PLATFORM_TEST checks=$checks native=$native process_bits=$([IntPtr]::Size * 8) x64_emulation_allowed=true no_installation=true"
