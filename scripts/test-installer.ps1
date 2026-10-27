[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$ResultFile, [string]$PreviousInstaller)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (!([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Installer smoke test requires elevation.' }
$installed = Join-Path $env:ProgramW6432 'MyNEIGE'
$registry = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE'
if ((Test-Path -LiteralPath $installed) -or (Test-Path -LiteralPath $registry)) { throw 'An existing MyNEIGE installation must not be changed by this test.' }
$checks = 0
function Assert-Installer([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }; $script:checks++
}
function Run-Installer([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(180000)) { throw 'Installer test process is still active; inspect before retrying.' }
    return $process.ExitCode
}
$mutex = $null
try {
    $mutex = [Threading.Mutex]::new($false, 'Global\MyNEIGE-Desktop-v1')
    Assert-Installer ((Run-Installer $Installer '/S') -eq 3) 'Installer did not refuse an active launcher.'
    Assert-Installer (!(Test-Path -LiteralPath $installed)) 'Busy installation wrote files.'
    $mutex.Dispose(); $mutex = $null
    $firstInstaller = if ($PreviousInstaller) { $PreviousInstaller } else { $Installer }
    Assert-Installer ((Run-Installer $firstInstaller '/S') -eq 0) 'Silent installation failed.'
    Assert-Installer (Test-Path -LiteralPath (Join-Path $installed 'MyNEIGE.exe')) 'Installed launcher absent.'
    Assert-Installer (Test-Path -LiteralPath $registry) 'Uninstall registration absent.'
    $shortcuts = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'MyNEIGE'
    Assert-Installer (Test-Path -LiteralPath (Join-Path $shortcuts 'MyNEIGE.lnk')) 'Start menu launcher absent.'
    $resetShortcut = 'MyNEIGE - Effacer les donn' + [char]0x00e9 + 'es locales.lnk'
    Assert-Installer (Test-Path -LiteralPath (Join-Path $shortcuts $resetShortcut)) 'French shortcut name is missing or corrupted.'
    . (Join-Path $installed 'scripts\distribution-common.ps1')
    $null = Test-DistributionPayload $installed; $checks++
    Assert-Installer ((Run-Installer (Join-Path $installed 'MyNEIGE.exe') '--check') -eq 0) 'Installed standalone check failed.'
    $previousManifest = Get-Content -LiteralPath (Join-Path $installed 'distribution.json') -Raw | ConvertFrom-Json
    $sentinel = Join-Path $installed 'installer-test-keep.txt'
    [IO.File]::WriteAllText($sentinel, 'Unlisted user content must survive upgrade and uninstall.')
    Assert-Installer ((Run-Installer $Installer '/S') -eq 0) 'Previous-version removal and reinstall failed.'
    $nextManifest = Get-Content -LiteralPath (Join-Path $installed 'distribution.json') -Raw | ConvertFrom-Json
    foreach ($entry in $previousManifest.files) {
        if ($entry.path -notin $nextManifest.files.path) {
            $oldFile = Get-PayloadPath $installed $entry.path
            Assert-Installer (!(Test-Path -LiteralPath $oldFile)) ('Obsolete installed file survived upgrade: ' + $entry.path)
        }
    }
    Assert-Installer (Test-Path -LiteralPath $sentinel) 'Upgrade deleted unlisted user content.'
    $null = Test-DistributionPayload $installed; $checks++
    $uninstall = Join-Path $installed 'Uninstall.exe'
    $mutex = [Threading.Mutex]::new($false, 'Global\MyNEIGE-Desktop-v1')
    Assert-Installer ((Run-Installer $uninstall ('/S _?=' + $installed)) -eq 3) 'Uninstaller did not refuse an active launcher.'
    Assert-Installer (Test-Path -LiteralPath (Join-Path $installed 'MyNEIGE.exe')) 'Busy uninstaller deleted files.'
    $mutex.Dispose(); $mutex = $null
    Assert-Installer ((Run-Installer $uninstall ('/S _?=' + $installed)) -eq 0) 'Uninstall failed.'
    Assert-Installer (!(Test-Path -LiteralPath (Join-Path $installed 'MyNEIGE.exe'))) 'Launcher survived uninstall.'
    Assert-Installer (!(Test-Path -LiteralPath $registry)) 'Uninstall registry survived.'
    Assert-Installer (!(Test-Path -LiteralPath $shortcuts)) 'Start menu shortcuts survived uninstall.'
    Assert-Installer (Test-Path -LiteralPath $sentinel) 'Unlisted user content was deleted.'
    # /_? keeps the test uninstaller in place; remove only known test leftovers.
    Remove-Item -LiteralPath $sentinel
    if (Test-Path -LiteralPath $uninstall) { Remove-Item -LiteralPath $uninstall }
    Assert-Installer (@(Get-ChildItem -LiteralPath $installed -Force).Count -eq 0) 'Unexpected installed files remain.'
    Remove-Item -LiteralPath $installed
    [IO.File]::WriteAllText($ResultFile, "INSTALLER_TEST passed checks=$checks install=true reinstall=true busy_refused=true uninstall=true unknown_file_preserved=true")
} catch {
    [IO.File]::WriteAllText($ResultFile, ('INSTALLER_TEST failed: ' + $_.Exception.Message))
    throw
} finally { if ($mutex) { $mutex.Dispose() } }
