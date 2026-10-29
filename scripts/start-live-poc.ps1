[CmdletBinding()]
param([string]$Profile, [switch]$ConsoleWorker, [switch]$RunChecks, [ValidateRange(1,60)][int]$Seconds = 30)
$ErrorActionPreference = 'Stop'
if (!$Profile) { throw 'Fournir -Profile avec le chemin du profil personnel.' }
$Profile = (Resolve-Path -LiteralPath $Profile).Path
$repoRoot = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $repoRoot '.local\poc\myneige-poc.exe'
$resultFile = Join-Path $repoRoot '.local\poc\live-session.txt'
$exitFile = Join-Path $repoRoot '.local\poc\live-exit-code.txt'
if (!(Test-Path -LiteralPath $binary)) { throw 'Compiler le pilote avant le lancement interactif.' }
if (!$ConsoleWorker) {
    if (Test-Path -LiteralPath $exitFile) { Remove-Item -LiteralPath $exitFile }
    # A visible console is necessary here: the user must enter credentials locally without echo.
    $consoleArgs = @('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-ConsoleWorker','-Profile',('"'+$Profile+'"'),'-Seconds',[string]$Seconds)
    if ($RunChecks) { $consoleArgs += '-RunChecks' }
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -PassThru -WorkingDirectory $repoRoot -ArgumentList $consoleArgs
    Write-Output "Console locale lancee (PID $($process.Id)). Saisir les identifiants uniquement dans cette console."
    Write-Output "Diagnostic sans identifiants : $resultFile"
    exit 0
}
Set-Location -LiteralPath $repoRoot
Write-Host 'MyNEIGE : essai VPN reel. Les deux champs sont masques ; delai de 90 secondes par champ.'
Write-Host 'Aucun mot de passe dans le chat. Ctrl+C demande le nettoyage et la fermeture du tunnel.'
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
[IO.File]::WriteAllText($resultFile, '', [Text.UTF8Encoding]::new($false))
if ($RunChecks) {
    foreach ($mode in @('wfp-test','adapter-test','auth-preflight','management-test')) {
        Write-Host "Controle local : $mode"
        & $binary $mode --profile $Profile 2>&1 | Tee-Object -FilePath $resultFile -Append
        $checkCode = $LASTEXITCODE
        if ($checkCode -ne 0) {
            [IO.File]::WriteAllText($exitFile, [string]$checkCode, [Text.UTF8Encoding]::new($false))
            $ErrorActionPreference = $previousPreference
            Write-Host 'Controle echoue ; aucun identifiant demande. Consulter le diagnostic.'
            return
        }
    }
}
# Only program diagnostics go to Tee-Object. The native reader uses the console directly, with no echo.
& $binary connect --profile $Profile --seconds ([string]$Seconds) 2>&1 | Tee-Object -FilePath $resultFile -Append
$nativeCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
[IO.File]::WriteAllText($exitFile, [string]$nativeCode, [Text.UTF8Encoding]::new($false))
Write-Host "Essai termine (code $nativeCode). Vous pouvez fermer cette console ; le resultat est conserve sans identifiants."
