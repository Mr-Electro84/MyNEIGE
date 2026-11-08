[CmdletBinding()]
param([switch]$Worker, [switch]$ForgetCredentials, [string]$OpenVpn)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'windows-platform.ps1')
Assert-MyneigeHost
$binary = Join-Path $root '.local\poc\myneige-poc.exe'
if ($ForgetCredentials) {
    if (!(Test-Path -LiteralPath $binary)) { throw 'Compiler le pilote avant le lancement.' }
    & (Join-Path $root '.local\poc\myneige-vault.exe') vault-forget; exit $LASTEXITCODE
}
Assert-MyneigeX64Runtime (Join-Path $root 'node_modules\electron\dist\electron.exe')
$out = Join-Path $root '.local\browser'
New-Item -ItemType Directory -Path $out -Force | Out-Null
if (!$Worker) {
    try {
        $setupResult = Join-Path $out ('setup-' + [Guid]::NewGuid().ToString('N') + '.json')
        $setupLog = Join-Path $out 'openvpn-preparation.txt'
        $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $preparation = & (Join-Path $root 'scripts\openvpn-setup.ps1') -Ensure -ResultFile $setupResult 2>&1
        $setupCode = $LASTEXITCODE; $ErrorActionPreference = $previous
        $preparation | Out-File -LiteralPath $setupLog -Encoding utf8
        if (!(Test-Path -LiteralPath $setupResult)) { throw "La preparation OpenVPN n'a pas retourne de resultat (code $setupCode). Diagnostic : $setupLog" }
        $result = Get-Content -LiteralPath $setupResult -Raw | ConvertFrom-Json
        Remove-Item -LiteralPath $setupResult
        if ($result.Status -in @('Cancelled','RebootRequired')) {
            Add-Type -AssemblyName System.Windows.Forms
            [Windows.Forms.MessageBox]::Show($result.Message, 'MyNEIGE - OpenVPN', 'OK', 'Information') | Out-Null
            exit $result.Code
        }
        if ($setupCode -ne 0 -or $result.Status -ne 'Ready') { throw ($result.Message + "`r`nEtape : " + $result.Stage + "`r`nDiagnostic : " + $setupLog) }
        $OpenVpn = [string]$result.Path
        if (!(Test-Path -LiteralPath $OpenVpn -PathType Leaf)) { throw 'Moteur OpenVPN verifie introuvable.' }
    } catch {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'MyNEIGE - Prerequis', 'OK', 'Warning') | Out-Null
        exit 1
    }
    $exitFile = Join-Path $out 'exit-code.txt'
    if (Test-Path -LiteralPath $exitFile) { Remove-Item -LiteralPath $exitFile }
    $logName = 'session-' + [Guid]::NewGuid().ToString('N') + '.txt'
    $p = Start-Process $binary -Verb RunAs -WindowStyle Hidden -PassThru -WorkingDirectory $root -ArgumentList @('distribution-browse','--project-root',('"'+$root+'"'),'--openvpn',('"'+$OpenVpn+'"'),'--log-name',$logName)
    Write-Output "MyNEIGE demarre (controleur PID $($p.Id)). Le formulaire s'ouvre apres les controles de protection."
    Write-Output "Diagnostic local sans identifiants : $(Join-Path $out 'live-session.txt')"
    # Keep the launcher alive so execution hosts do not reap the supervised tree.
    $p.WaitForExit()
    $protectedLog = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('MyNEIGE-Logs\' + $logName)
    if (Test-Path -LiteralPath $protectedLog) { Copy-Item -LiteralPath $protectedLog -Destination (Join-Path $out 'live-session.txt') }
    [IO.File]::WriteAllText($exitFile, [string]$p.ExitCode)
    exit $p.ExitCode
}
Set-Location -LiteralPath $root
$ErrorActionPreference = 'Continue'
if (!$OpenVpn) { throw 'Moteur OpenVPN verifie requis.' }
& $binary browse --project-root $root --openvpn $OpenVpn 2>&1 | Tee-Object -FilePath (Join-Path $out 'live-session.txt')
$code = $LASTEXITCODE
[IO.File]::WriteAllText((Join-Path $out 'exit-code.txt'), [string]$code)
exit $code
