[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $PSScriptRoot 'openvpn-setup.ps1'
$fixture = Join-Path $root ('.local\false installer ' + [Guid]::NewGuid().ToString('N') + '.msi')
try {
    [IO.File]::WriteAllText($fixture, 'Not an installer. MyNEIGE synthetic fixture.')
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup -VerifyOnly -Package $fixture 2>&1
    $code = $LASTEXITCODE; $ErrorActionPreference = $previous
    if ($code -eq 0) { throw 'An untrusted installer was accepted.' }
    Write-Output 'OPENVPN_SETUP_TEST forged_package_refused=true no_installation=true'
} finally { if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture } }
