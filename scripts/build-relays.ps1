[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$repoRoot = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio Build Tools C++ et Windows SDK requis.' }
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'Composant C++ x64 Visual Studio absent.' }
$devCmd = Join-Path $vsRoot 'Common7\Tools\VsDevCmd.bat'
# Graphe fermé : aucun fichier du contrôleur, du coffre ou du lancement de processus.
$sharedSources = @('native\windows\shared\network.cpp','native\windows\shared\network-protocol.cpp',
    'native\windows\shared\hash.cpp','native\windows\shared\worker-origin.cpp')
$relaySources = @('native\windows\relay\main.cpp','native\windows\relay\worker.cpp') + $sharedSources
$probeSources = @('native\windows\probes\main.cpp','native\windows\probes\probes.cpp') + $sharedSources
$targets = @(
    @{ Name='myneige-relay.exe'; Role='vpn'; Definition='/DMYNEIGE_PUBLIC_RELAY=0'; Sources=$relaySources; Description='MyNEIGE - Relais VPN' },
    @{ Name='myneige-public-relay.exe'; Role='public'; Definition='/DMYNEIGE_PUBLIC_RELAY=1'; Sources=$relaySources; Description='MyNEIGE - Relais des services publics' },
    @{ Name='myneige-probe.exe'; Role='probes'; Definition=''; Sources=$probeSources; Description='MyNEIGE - Sondes de developpement' }
)
foreach ($target in $targets) {
    $buildRoot = Join-Path $repoRoot ('.local\poc\relay-build-' + $target.Role)
    New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
    $binary = Join-Path $repoRoot ('.local\poc\' + $target.Name)
    & (Join-Path $PSScriptRoot 'write-version-resource.ps1') -Destination (Join-Path $buildRoot 'relay.rc') -FileName $target.Name -Description $target.Description
    $sources = $target.Sources | ForEach-Object { '"' + (Join-Path $repoRoot $_) + '"' }
    $compilerArgs = '/nologo /MP2 /MT /std:c++20 /EHsc /W4 /WX /utf-8 /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00 /O2 /guard:cf /sdl ' + $target.Definition + ' ' + ($sources -join ' ') + ' relay.res /Fe:"' + $binary + '" /link /DYNAMICBASE /NXCOMPAT ws2_32.lib iphlpapi.lib bcrypt.lib advapi32.lib'
    $buildScript = Join-Path $buildRoot 'compile-relay.cmd'
    $batch = '@echo off' + "`r`n" + 'call "' + $devCmd + '" -arch=x64 -host_arch=x64 >nul' + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'rc.exe /nologo /fo relay.res relay.rc' + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'cl.exe ' + $compilerArgs + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'dumpbin.exe /nologo /imports "' + $binary + '" > relay-imports.txt' + "`r`n" + 'exit /b %errorlevel%' + "`r`n"
    [IO.File]::WriteAllText($buildScript, $batch, [Text.UTF8Encoding]::new($false))
    Push-Location -LiteralPath $buildRoot
    try { & $env:ComSpec /d /c $buildScript; if ($LASTEXITCODE -ne 0) { throw "Compilation du relais $($target.Role) echouee ($LASTEXITCODE)." } }
    finally { Pop-Location }
    [IO.File]::WriteAllText((Join-Path $buildRoot 'relay-sha256.txt'), (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash)
    Write-Output $binary
}
& (Join-Path $PSScriptRoot 'test-relays.ps1') -StaticOnly
