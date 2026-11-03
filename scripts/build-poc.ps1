[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio Build Tools C++ et Windows SDK requis.' }
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'Composant C++ x64 Visual Studio absent.' }
$buildRoot = Join-Path $repoRoot '.local\poc'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$devCmd = Join-Path $vsRoot 'Common7\Tools\VsDevCmd.bat'
$sourceRoot = Join-Path $repoRoot 'native\windows\poc'
$sources = Get-ChildItem -LiteralPath $sourceRoot -Filter '*.cpp' | ForEach-Object { '"' + $_.FullName + '"' }
$sources += @('hash.cpp','vpn-profile.cpp') | ForEach-Object { '"' + (Join-Path $repoRoot ('native\windows\shared\' + $_)) + '"' }
$resourceScript = Join-Path $buildRoot 'controller.rc'
& (Join-Path $PSScriptRoot 'write-version-resource.ps1') -Destination $resourceScript -FileName 'myneige-controller.exe' -Description 'MyNEIGE - Controleur reseau'
$compilerArgs = '/nologo /MP2 /MT /std:c++20 /EHsc /W4 /WX /utf-8 /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00 /O2 /guard:cf /sdl ' + ($sources -join ' ') + ' controller.res /Fe:"myneige-poc.exe" /link /DYNAMICBASE /NXCOMPAT ws2_32.lib iphlpapi.lib fwpuclnt.lib bcrypt.lib advapi32.lib ole32.lib winhttp.lib shell32.lib wintrust.lib crypt32.lib version.lib windowsapp.lib userenv.lib user32.lib'
$buildScript = Join-Path $buildRoot 'compile.cmd'
$batch = '@echo off' + "`r`n" + 'call "' + $devCmd + '" -arch=x64 -host_arch=x64 >nul' + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'rc.exe /nologo /fo controller.res controller.rc' + "`r`n" + 'if errorlevel 1 exit /b %errorlevel%' + "`r`n" + 'cl.exe ' + $compilerArgs + "`r`n" + 'exit /b %errorlevel%' + "`r`n"
[IO.File]::WriteAllText($buildScript, $batch, [Text.UTF8Encoding]::new($false))
Push-Location -LiteralPath $buildRoot
try { & $env:ComSpec /d /c $buildScript; if ($LASTEXITCODE -ne 0) { throw "Compilation du pilote echouee ($LASTEXITCODE)." } }
finally { Pop-Location }
Write-Output (Join-Path $buildRoot 'myneige-poc.exe')
& (Join-Path $PSScriptRoot 'build-vault.ps1')
