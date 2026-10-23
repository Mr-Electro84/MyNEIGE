[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $PSScriptRoot 'openvpn-setup.ps1'
. (Join-Path $PSScriptRoot 'openvpn-prerequisites.ps1')
$checks = 0
function Assert-Setup([bool]$Ok, [string]$Message) { if (!$Ok) { throw $Message }; $script:checks++ }
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
    $cached = Join-Path $root '.local\downloads\OpenVPN-2.7.8-I001-amd64.msi'
    if (Test-Path -LiteralPath $cached) {
        $product = Get-OpenVpnMsiProductCode $cached
        Assert-Setup ($product -match '^\{[A-Fa-f0-9-]{36}\}$') 'Signed fixture MSI product lookup failed.'
    }
    Write-Output "OPENVPN_SETUP_TEST checks=$checks missing_offer=true incomplete_offer=true cancellation=true reboot=true precise_errors=true no_installation=true"
} finally {
    foreach ($file in @($fixture,$resultFile)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
}
