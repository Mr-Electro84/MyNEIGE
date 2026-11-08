# L'architecture native de Windows reste distincte de celle du processus emule.
# npm peut transmettre PSModulePath de PowerShell 7 a Windows PowerShell 5.1.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
function Get-MyneigeNativeArchitecture {
    if (!('MyNeige.NativePlatform' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace MyNeige {
    public static class NativePlatform {
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
        public static string ArchitectureName(ushort machine) {
            switch (machine) {
                case 0x8664: return "X64";
                case 0xAA64: return "Arm64";
                default: throw new PlatformNotSupportedException("MyNEIGE requiert Windows x64 ou ARM64.");
            }
        }
        public static string Architecture() {
            ushort processMachine, nativeMachine;
            if (!IsWow64Process2(new IntPtr(-1), out processMachine, out nativeMachine))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return ArchitectureName(nativeMachine);
        }
    }
}
'@
    }
    return [MyNeige.NativePlatform]::Architecture()
}
function Assert-MyneigeHost {
    param([string]$Architecture = (Get-MyneigeNativeArchitecture), [int]$WindowsBuild = [Environment]::OSVersion.Version.Build)
    if ($Architecture -notin @('X64','Arm64') -or $WindowsBuild -lt 22000) {
        throw 'MyNEIGE requiert Windows 11 x64 ou ARM64 (application x64 sous emulation).'
    }
}
function Get-MyneigeSystemExecutable([string]$RelativePath) {
    # Sysnative evite la redirection de System32 depuis un PowerShell 32 bits.
    $system = Join-Path $env:SystemRoot 'Sysnative'
    if (!(Test-Path -LiteralPath $system -PathType Container)) { $system = Join-Path $env:SystemRoot 'System32' }
    return Join-Path $system $RelativePath
}
function Get-MyneigePeMachine([string]$Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5A4D) { throw 'Executable PE invalide.' }
        $stream.Position = 0x3c
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset -gt $stream.Length - 24) { throw 'Entete PE invalide.' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Signature PE invalide.' }
        return $reader.ReadUInt16()
    } finally { $reader.Dispose() }
}
function Assert-MyneigeX64Runtime([string]$Path) {
    if ((Get-MyneigePeMachine $Path) -ne 0x8664) {
        throw 'Electron x64 requis, y compris sur ARM64. Reinstaller les dependances avec ELECTRON_INSTALL_ARCH=x64 (voir docs/WINDOWS_ARM64.md).'
    }
}
