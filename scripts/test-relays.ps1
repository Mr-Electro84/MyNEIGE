[CmdletBinding()]
param([switch]$StaticOnly)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$root = Split-Path -Parent $PSScriptRoot
$hashes = @()
foreach ($role in @('vpn','public')) {
    $name = if ($role -eq 'vpn') { 'myneige-relay.exe' } else { 'myneige-public-relay.exe' }
    $binary = Join-Path $root ('.local\poc\' + $name)
    $report = Join-Path $root ('.local\poc\relay-build-' + $role + '\relay-imports.txt')
    $imports = Get-Content -LiteralPath $report -Raw
    if ($imports -match '(?im)\b(fwpuclnt|winhttp|wininet|dnsapi|crypt32|shell32|userenv)\.dll|\b(Fwpm\w*|CreateProcess\w*|ShellExecute\w*|WinExec|CreateRemoteThread\w*|WriteProcessMemory|CreateRestrictedToken|DuplicateTokenEx|SetTokenInformation|SetSecurityInfo|SetFileSecurity\w*|CopyFile\w*|CryptProtectData|CryptUnprotectData|CreateIpForwardEntry2|DeleteIpForwardEntry2|SetIpInterfaceEntry)\b') {
        throw "Capacite interdite dans le relais $role."
    }
    if ($imports -notmatch '(?im)\bWS2_32\.dll\b' -or $imports -notmatch '\bGetAdaptersAddresses\b') {
        throw "Imports reseau attendus absents du relais $role."
    }
    $hash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
    # Le rapport est lié au fichier audité, même si les tests sont relancés plus tard.
    $hashFile = Join-Path (Split-Path -Parent $report) 'relay-sha256.txt'
    if ((Get-Content -LiteralPath $hashFile -Raw).Trim() -cne $hash) { throw 'Rapport obsolete : recompiler les relais.' }
    $hashes += $hash
    if (!$StaticOnly) {
        $capabilities = @(& $binary --capabilities)
        if ($LASTEXITCODE -ne 0 -or ($capabilities -join "`n") -cne "MYNEIGE_RELAY_PROTOCOL=1`nMYNEIGE_RELAY_ROLE=$role") { throw "Role inattendu : $role" }
        foreach ($command in @('connect','cleanup','relay-worker','public-relay-worker','vault-worker')) {
            & $binary $command
            if ($LASTEXITCODE -ne 2) { throw "Commande non attribuee acceptee : $command" }
        }
        # Sans son superviseur élevé, aucun relais ne doit ouvrir un listener.
        $previous = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $global:LASTEXITCODE = $null
            $lines = @(& $binary 2>&1)
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previous }
        if ($code -ne 1 -or ($lines -join "`n") -cne 'RELAY_ERROR') { throw "Appel hors session non refuse : $role" }
    }
}
if ($hashes[0] -ceq $hashes[1]) { throw 'Les deux roles utilisent le meme binaire.' }
Write-Output "RELAY_BOUNDARY_TEST static=$StaticOnly distinct_roles=true network_only=true process_launcher=false wfp=false self_copy=false"
