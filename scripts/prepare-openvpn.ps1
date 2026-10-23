[CmdletBinding()]
param([switch]$Install)
# Compatibility entry point; the application uses the same preparation flow.
& (Join-Path $PSScriptRoot 'openvpn-setup.ps1') -Install:$Install
exit $LASTEXITCODE
