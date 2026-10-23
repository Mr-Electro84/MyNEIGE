[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'Visual Studio Build Tools C++ x64 requis.' }
$out = Join-Path $root '.local\launcher'
New-Item -ItemType Directory -Path $out -Force | Out-Null
& (Join-Path $PSScriptRoot 'write-version-resource.ps1') -Destination (Join-Path $out 'launcher.rc') -FileName 'MyNEIGE.exe' -Description 'MyNEIGE - Lanceur'
$source = Join-Path $root 'native\windows\launcher\main.cpp'
$devCmd = Join-Path $vsRoot 'Common7\Tools\VsDevCmd.bat'
$lines = @('@echo off', ('call "' + $devCmd + '" -arch=x64 -host_arch=x64 >nul'),
    'if errorlevel 1 exit /b %errorlevel%', 'rc.exe /nologo /fo launcher.res launcher.rc',
    'if errorlevel 1 exit /b %errorlevel%',
    ('cl.exe /nologo /MT /std:c++20 /EHsc /W4 /WX /utf-8 /DUNICODE /D_UNICODE /O2 /guard:cf /sdl "' + $source + '" launcher.res /Fe:MyNEIGE.exe /link /SUBSYSTEM:WINDOWS /DYNAMICBASE /NXCOMPAT /MANIFESTUAC:"level=''asInvoker'' uiAccess=''false''" shell32.lib user32.lib ole32.lib'),
    'exit /b %errorlevel%')
$batch = Join-Path $out 'compile.cmd'
[IO.File]::WriteAllLines($batch, $lines, [Text.UTF8Encoding]::new($false))
Push-Location -LiteralPath $out
try { & $env:ComSpec /d /c $batch; if ($LASTEXITCODE -ne 0) { throw "Compilation du lanceur echouee ($LASTEXITCODE)." } }
finally { Pop-Location }
Write-Output (Join-Path $out 'MyNEIGE.exe')
