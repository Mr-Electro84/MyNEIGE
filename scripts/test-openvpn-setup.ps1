[CmdletBinding()]
param([switch]$FreshDownload)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $PSScriptRoot 'openvpn-setup.ps1'
. (Join-Path $PSScriptRoot 'openvpn-prerequisites.ps1')
. (Join-Path $PSScriptRoot 'openvpn-driver-store.ps1')
$checks = 0
function Assert-Setup([bool]$Ok, [string]$Message) { if (!$Ok) { throw $Message }; $script:checks++ }
# Old builds returned help/code 2 instead of executing openvpn-check. Reproduce
# that contract without modifying the installed engine or launching an MSI.
$legacy = [pscustomobject]@{ Code = 2; Output = 'MyNEIGE Windows network pilot' }
$supported = [pscustomobject]@{ Code = 0; Output = 'MYNEIGE_SETUP_PROTOCOL=1' }
function Invoke-CheckerScenario($Initial, [bool]$AllowBuild, $After = $supported) {
    $state = @{ Current = $Initial; Builds = 0; Probes = 0 }
    $probe = { $state.Probes++; return $state.Current }.GetNewClosure()
    $build = { $state.Builds++; $state.Current = $After }.GetNewClosure()
    $errorMessage = ''
    try { Confirm-OpenVpnNativeChecker -Probe $probe -Build $build -AllowBuild $AllowBuild }
    catch { $errorMessage = $_.Exception.Message }
    return [pscustomobject]@{ State = $state; Error = $errorMessage }
}
$case = Invoke-CheckerScenario $legacy $false
Assert-Setup ($case.Error -like '*Pilote natif MyNEIGE*obsolete*' -and $case.State.Builds -eq 0) 'Readonly diagnosis must report the stale MyNEIGE checker without compiling.'
$case = Invoke-CheckerScenario $legacy $true
Assert-Setup ($case.Error -eq '' -and $case.State.Builds -eq 1 -and $case.State.Probes -eq 2) 'A stale checker must be rebuilt once and verified again before preparation.'
$case = Invoke-CheckerScenario $supported $true
Assert-Setup ($case.Error -eq '' -and $case.State.Builds -eq 0) 'A current checker must not trigger compilation.'
$case = Invoke-CheckerScenario $legacy $true $legacy
Assert-Setup ($case.Error -like '*npm run poc:build*' -and $case.State.Builds -eq 1) 'A rebuild that still produces an incompatible checker must stop preparation.'
$case = Invoke-CheckerScenario ([pscustomobject]@{ Code = -1; Output = '' }) $true
Assert-Setup ($case.Error -eq '' -and $case.State.Builds -eq 1) 'A missing native checker must be built before preparation.'
$case = Invoke-CheckerScenario ([pscustomobject]@{ Code = 1; Output = 'MYNEIGE_SETUP_PROTOCOL=1' }) $false
Assert-Setup ($case.Error -ne '') 'A protocol marker with failure exit code cannot be accepted.'
$buildError = ''
try { Confirm-OpenVpnNativeChecker -Probe { $legacy } -Build { throw 'Build Tools fixture missing' } -AllowBuild $true }
catch { $buildError = $_.Exception.Message }
Assert-Setup ($buildError -eq 'Build Tools fixture missing') 'A compilation failure must stop preparation and preserve its cause.'
Assert-Setup (Test-OpenVpnNativeResult ([pscustomobject]@{ Code = 0; Output = 'OPENVPN_COMPATIBLE' })) 'Native success requires both the exit code and the success marker.'
Assert-Setup (!(Test-OpenVpnNativeResult ([pscustomobject]@{ Code = 1; Output = 'ERROR: OpenVPN signature rejected' }))) 'A real native signature rejection must remain a rejection.'
foreach ($invalid in @($legacy, [pscustomobject]@{ Code = 0; Output = '' }, [pscustomobject]@{ Code = 1; Output = 'OPENVPN_COMPATIBLE' }, [pscustomobject]@{ Code = -1073741515; Output = '' })) {
    $errorMessage = ''
    try { $null = Test-OpenVpnNativeResult $invalid } catch { $errorMessage = $_.Exception.Message }
    Assert-Setup ($errorMessage -like '*verificateur natif MyNEIGE*') 'A command/protocol/runtime failure cannot be reported as an invalid OpenVPN signature.'
}
$binary = Join-Path $root '.local\poc\myneige-poc.exe'
$protocol = Invoke-OpenVpnNativeCommand -Binary $binary -Arguments @('setup-capabilities')
Assert-Setup ($protocol.Code -eq 0 -and $protocol.Output -ceq 'MYNEIGE_SETUP_PROTOCOL=1') 'The real native checker must implement the expected setup protocol. Run npm run poc:build first.'
$missing = Get-OpenVpnDecision -TapReady $false
Assert-Setup ($missing.State -eq 'Missing') 'An empty inventory must offer installation.'
$incomplete = Get-OpenVpnDecision -Registered @([pscustomobject]@{ DisplayName = 'OpenVPN' }) -TapReady $false
Assert-Setup ($incomplete.State -eq 'Incomplete') 'Uninstall remnants must offer installation/repair.'
$partial = Get-OpenVpnDecision -Existing @('engine.exe') -Partial @('engine.exe') -TapReady $true
Assert-Setup ($partial.State -eq 'Incomplete') 'Missing tapctl cannot be considered ready.'
$driverMissing = Get-OpenVpnDecision -Existing @('engine.exe') -Validated @('engine.exe') -TapReady $false
Assert-Setup ($driverMissing.State -eq 'Incomplete') 'A missing driver must offer repair.'
$ready = Get-OpenVpnDecision -Existing @('engine.exe') -Validated @('engine.exe') -TapReady $true
Assert-Setup ($ready.State -eq 'Ready' -and $ready.Path -eq 'engine.exe') 'Compatible installation not detected.'
$unsupported = Get-OpenVpnDecision -Existing @('untrusted.exe') -TapReady $false
Assert-Setup ($unsupported.State -eq 'Unsupported') 'Invalid binaries cannot be overwritten automatically.'
$connectOnly = Get-OpenVpnDecision -Registered @([pscustomobject]@{ DisplayName = 'OpenVPN Connect' }) -TapReady $false
Assert-Setup ($connectOnly.State -eq 'Missing') 'Connect is not a Community engine.'
function Invoke-Scenario($State, [bool]$Agree = $true, [int]$InstallerCode = 0, [string]$Architecture = 'X64', [bool]$BadDownload = $false, $After = $ready) {
    $trace = [Collections.Generic.List[string]]::new()
    $confirm = { param($ignored) $trace.Add('offer'); return $Agree }.GetNewClosure()
    $download = { $trace.Add('download'); if ($BadDownload) { throw 'Fake download failure' }; return 'verified-fixture.msi' }.GetNewClosure()
    $install = { param($ignored) $trace.Add('install'); return $InstallerCode }.GetNewClosure()
    $recheck = { $trace.Add('recheck'); return $After }.GetNewClosure()
    try {
        $result = Invoke-OpenVpnPreparation -State $State -Architecture $Architecture -Confirm $confirm -Download $download -InstallPackage $install -Recheck $recheck
        return [pscustomobject]@{ Result = $result; Steps = ($trace -join ','); Error = '' }
    } catch { return [pscustomobject]@{ Result = $null; Steps = ($trace -join ','); Error = $_.Exception.Message } }
}
foreach ($state in @($missing,$incomplete,$driverMissing,$partial)) {
    $case = Invoke-Scenario $state
    Assert-Setup ($case.Result.Status -eq 'Ready' -and $case.Steps -eq 'offer,download,install,recheck') 'Missing/incomplete flow failed to offer and install.'
}
$case = Invoke-Scenario $ready
Assert-Setup ($case.Result.Status -eq 'Ready' -and $case.Steps -eq '') 'Existing engine must not invoke the installer.'
$case = Invoke-Scenario $missing -Agree $false
Assert-Setup ($case.Result.Status -eq 'Cancelled' -and $case.Steps -eq 'offer') 'Cancellation must perform no download or installation.'
$case = Invoke-Scenario $missing -InstallerCode 3010
Assert-Setup ($case.Result.Status -eq 'RebootRequired' -and $case.Steps -eq 'offer,download,install') 'A required restart cannot be reported as ready.'
$case = Invoke-Scenario $missing -InstallerCode 1602
Assert-Setup ($case.Result.Status -eq 'Cancelled' -and $case.Steps -eq 'offer,download,install') 'MSI/UAC cancellation must stop startup without a generic failure.'
$case = Invoke-Scenario $missing -InstallerCode 1603
Assert-Setup ($case.Error -like '*1603*' -and $case.Steps -eq 'offer,download,install') 'MSI error must remain visible.'
$case = Invoke-Scenario $missing -BadDownload $true
Assert-Setup ($case.Error -ne '' -and $case.Steps -eq 'offer,download') 'Failed verification/download must prevent installation.'
$case = Invoke-Scenario $unsupported
Assert-Setup ($case.Error -ne '' -and $case.Steps -eq '') 'Unsupported files must block automated replacement.'
$case = Invoke-Scenario $missing -Architecture 'Arm64'
Assert-Setup ($case.Error -like '*Arm64*' -and $case.Steps -eq '') 'Architecture mismatch must be explicit.'
$case = Invoke-Scenario $missing -After $incomplete
Assert-Setup ($case.Error -ne '' -and $case.Steps -eq 'offer,download,install,recheck') 'Final prerequisite validation must remain mandatory.'
$failedCheck = [pscustomobject]@{ State = 'Incomplete'; Path = ''; Message = 'paquet_TAP=False; controle_natif=1' }
$case = Invoke-Scenario $missing -After $failedCheck
Assert-Setup ($case.Error -like '*paquet_TAP=False*controle_natif=1*') 'Final validation must preserve the component failure rather than return a generic code.'
# Query the actual Driver Store read-only. No adapter/service is created.
$driverInf = Get-OpenVpnTapDriver
foreach ($id in @('tap0901','root\tap0901','ROOT\TAP0901')) { Assert-Setup ([MyNeige.TapDriverStore]::IsTapHardwareId($id)) 'The exact TAP hardware ID must be accepted.' }
foreach ($id in @('ovpn-dco','root\tap0901-foreign','tap0901.evil','root\other')) { Assert-Setup (![MyNeige.TapDriverStore]::IsTapHardwareId($id)) 'A foreign network driver cannot satisfy the TAP prerequisite.' }
if ($driverInf) {
    Assert-Setup (Test-Path -LiteralPath $driverInf -PathType Leaf) 'The driver store returned an unavailable INF.'
    $staged = Get-OpenVpnDecision -Existing @('engine.exe') -Validated @('engine.exe') -TapReady ([bool]$driverInf)
    Assert-Setup ($staged.State -eq 'Ready') 'An installed TAP package must not require an active adapter or service.'
}
Write-Output ('OPENVPN_DRIVER_STORE_TEST read_only=true package_found=' + [bool]$driverInf)
$fixture = Join-Path $root ('.local\false installer ' + [Guid]::NewGuid().ToString('N') + '.msi')
$resultFile = $fixture + '.json'
try {
    [IO.File]::WriteAllText($fixture, 'Not an installer. MyNEIGE synthetic fixture.')
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup -VerifyOnly -Package $fixture -ResultFile $resultFile 2>&1
    $code = $LASTEXITCODE; $ErrorActionPreference = $previous
    if ($code -eq 0) { throw 'An untrusted installer was accepted.' }
    $diagnostic = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    Assert-Setup ($diagnostic.Status -eq 'Error' -and $diagnostic.Stage -eq 'Verification paquet' -and $diagnostic.Message -like '*Empreinte*') 'The launcher must receive the actual failure reason.'
    Assert-Setup (($output | Out-String) -match 'OPENVPN_SETUP_ERROR stage=Verification paquet line=\d+ type=') 'The diagnostic must preserve the failure location and exception type.'
    $nativeRejection = Invoke-OpenVpnNativeCommand -Binary $binary -Arguments @('openvpn-check','--openvpn',$fixture)
    Assert-Setup (!(Test-OpenVpnNativeResult $nativeRejection) -and $nativeRejection.Output -like 'ERROR:*') 'The real native checker must still reject an unsigned synthetic engine.'
    $cached = Join-Path $root '.local\downloads\OpenVPN-2.7.8-I001-amd64.msi'
    if (Test-Path -LiteralPath $cached) {
        $product = Get-OpenVpnMsiProductCode $cached
        Assert-Setup ($product -match '^\{[A-Fa-f0-9-]{36}\}$') 'Signed fixture MSI product lookup failed.'
    }
    if ($FreshDownload) {
        $freshDirectory = Join-Path $root ('.local\setup-download-test-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $freshDirectory | Out-Null
        $freshResult = Join-Path $freshDirectory 'result.json'
        $freshPackage = Join-Path $freshDirectory 'OpenVPN-2.7.8-I001-amd64.msi'
        try {
            Assert-Setup (!(Test-Path -LiteralPath $freshPackage)) 'Fresh download must start without a cached MSI.'
            $powershell51 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            # No -Install / -Ensure: download and verify only, never start MSI/UAC.
            $downloadOutput = & $powershell51 -NoProfile -ExecutionPolicy Bypass -File $setup -DownloadDirectory $freshDirectory -ResultFile $freshResult 2>&1
            $downloadCode = $LASTEXITCODE; $ErrorActionPreference = $previous
            if ($downloadCode -ne 0) { throw ('Fresh Windows PowerShell 5.1 download failed: ' + ($downloadOutput | Out-String)) }
            $downloadResult = Get-Content -LiteralPath $freshResult -Raw | ConvertFrom-Json
            Assert-Setup ($downloadResult.Status -eq 'Downloaded') 'Fresh download did not finish verification.'
            Assert-Setup ((Get-FileHash -LiteralPath $freshPackage -Algorithm SHA256).Hash -eq '1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49') 'Fresh MSI hash differs from the qualified package.'
            Assert-Setup ((Get-AuthenticodeSignature -LiteralPath $freshPackage).Status -eq 'Valid') 'Fresh MSI signature is not valid.'
            Assert-Setup (@(Get-ChildItem -LiteralPath $freshDirectory -Filter '*.part').Count -eq 0) 'Fresh download left an incomplete file.'
            Write-Output 'OPENVPN_FRESH_DOWNLOAD_TEST windows_powershell_51=true cache_used=false hash=true signature=true installation=false'
        } finally {
            # Known, unique workspace fixture only. No recursive delete.
            foreach ($file in @($freshPackage,$freshResult)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
            foreach ($partialFile in @(Get-ChildItem -LiteralPath $freshDirectory -Filter '*.part' -File)) { Remove-Item -LiteralPath $partialFile.FullName }
            Remove-Item -LiteralPath $freshDirectory
        }
    }
    Write-Output "OPENVPN_SETUP_TEST checks=$checks missing_offer=true incomplete_offer=true cancellation=true reboot=true precise_errors=true no_installation=true"
} finally {
    foreach ($file in @($fixture,$resultFile)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
}
