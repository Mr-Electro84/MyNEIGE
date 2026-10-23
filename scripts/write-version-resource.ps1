[CmdletBinding()]
param([Parameter(Mandatory)][string]$Destination, [Parameter(Mandatory)][string]$FileName,
      [Parameter(Mandatory)][string]$Description)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$metadata = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($metadata.version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$') { throw 'Version Windows non prise en charge.' }
$numeric = @($Matches[1], $Matches[2], $Matches[3], $(if ($Matches[4]) { $Matches[4] } else { '0' })) -join ','
$icon = (Join-Path $root 'assets\myneige.ico').Replace('\','\\')
$text = @"
#pragma code_page(65001)
#include <windows.h>
1 ICON "$icon"
1 VERSIONINFO
 FILEVERSION $numeric
 PRODUCTVERSION $numeric
 FILEFLAGSMASK VS_FFI_FILEFLAGSMASK
 FILEFLAGS VS_FF_PRERELEASE
 FILEOS VOS_NT_WINDOWS32
 FILETYPE VFT_APP
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "040C04B0"
  BEGIN
   VALUE "CompanyName", "Matra DevProd\0"
   VALUE "FileDescription", "$Description\0"
   VALUE "FileVersion", "$($metadata.version)\0"
   VALUE "InternalName", "$FileName\0"
   VALUE "OriginalFilename", "$FileName\0"
   VALUE "ProductName", "MyNEIGE\0"
   VALUE "ProductVersion", "$($metadata.version)\0"
   VALUE "LegalCopyright", "Matra DevProd - Apache-2.0\0"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x040C, 1200
 END
END
"@
[IO.File]::WriteAllText($Destination, $text, [Text.UTF8Encoding]::new($false))
