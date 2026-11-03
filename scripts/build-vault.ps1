[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio Build Tools C++ et Windows SDK requis.' }
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'Composant C++ x64 Visual Studio absent.' }
$buildRoot = Join-Path $repoRoot '.local\poc\vault-build'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$devCmd = Join-Path $vsRoot 'Common7\Tools\VsDevCmd.bat'
# Liste fermée : le coffre ne doit jamais embarquer les sources du contrôleur réseau.
$sourceFiles = @('native\windows\vault\main.cpp','native\windows\vault\vault.cpp',
    'native\windows\shared\hash.cpp','native\windows\shared\vpn-profile.cpp')
$sources = $sourceFiles | ForEach-Object { '"' + (Join-Path $repoRoot $_) + '"' }
$binary = Join-Path $repoRoot '.local\poc\myneige-vault.exe'
& (Join-Path $PSScriptRoot 'write-version-resource.ps1') -Destination (Join-Path $buildRoot 'vault.rc') -FileName 'myneige-vault.exe' -Description 'MyNEIGE - Coffre local DPAPI et Windows Hello'
$compilerArgs = '/nologo /MP2 /MT /std:c++20 /EHsc /W4 /WX /utf-8 /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00 /O2 /guard:cf /sdl ' + ($sources -join ' ') + ' vault.res /Fe:"' + $binary + '" /link /DYNAMICBASE /NXCOMPAT bcrypt.lib advapi32.lib ole32.lib shell32.lib crypt32.lib windowsapp.lib user32.lib'
$buildScript = Join-Path $buildRoot 'compile-vault.cmd'
$batch = '@echo off' + "`r`n" + 'call "' + $devCmd + '" -arch=x64 -host_arch=x64 >nul' + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'rc.exe /nologo /fo vault.res vault.rc' + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'cl.exe ' + $compilerArgs + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'dumpbin.exe /nologo /imports "' + $binary + '" > vault-imports.txt' + "`r`n" + 'exit /b %errorlevel%' + "`r`n"
[IO.File]::WriteAllText($buildScript, $batch, [Text.UTF8Encoding]::new($false))
Push-Location -LiteralPath $buildRoot
try { & $env:ComSpec /d /c $buildScript; if ($LASTEXITCODE -ne 0) { throw "Compilation du coffre echouee ($LASTEXITCODE)." } }
finally { Pop-Location }
$imports = Get-Content -LiteralPath (Join-Path $buildRoot 'vault-imports.txt') -Raw
if ($imports -match '(?im)\b(ws2_32|fwpuclnt|winhttp|iphlpapi)\.dll|\b(CreateProcess[A-Z]*|ShellExecute[A-Z]*)\b') {
    throw 'Le coffre importe une API reseau, WFP ou de lancement de processus interdite.'
}
Write-Output $binary
