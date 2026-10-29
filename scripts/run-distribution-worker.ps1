[CmdletBinding()]
param([Parameter(Mandatory)][string]$LogName, [switch]$BrowserTest, [string]$OpenVpn)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (!([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Controleur : elevation requise.' }
if ($LogName -cnotmatch '^session-[a-f0-9]{32}\.txt$') { throw 'Nom de diagnostic invalide.' }
$directory = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'MyNEIGE-Logs'
if (Test-Path -LiteralPath $directory) {
    $item = Get-Item -LiteralPath $directory -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Diagnostic redirige refuse.' }
    if ((Get-Acl -LiteralPath $directory).GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-32-544','S-1-5-18')) { throw 'Proprietaire du diagnostic non administratif.' }
} else { New-Item -ItemType Directory -Path $directory | Out-Null }
# Sanitized logs are readable, never writable, by unelevated users.
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)')
Set-Acl -LiteralPath $directory -AclObject $acl
$log = Join-Path $directory $LogName
if (Test-Path -LiteralPath $log) { throw 'Diagnostic deja present.' }
$binary = Join-Path $root 'bin\myneige-controller.exe'
$ErrorActionPreference = 'Continue'
if ($BrowserTest) { & $binary browser-test --project-root $root *> $log }
else { & $binary browse --project-root $root --openvpn $OpenVpn *> $log }
$code = $LASTEXITCODE
# Closing the credential form before submitting is a normal cancellation.
if ($code -ne 0 -and (Select-String -LiteralPath $log -SimpleMatch 'ERROR: Cancelled in browser' -Quiet)) { $code = 0 }
exit $code
