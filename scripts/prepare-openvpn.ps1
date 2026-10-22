[CmdletBinding()]
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = '2.7.8-I001'
$filename = "OpenVPN-$version-amd64.msi"
$expectedHash = '1EA61A3056905B90607D4B0F084C04E5CF3043E07CF192D9CD44B0474F29CC49'
$downloadDirectory = Join-Path $repoRoot '.local\downloads'
New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
$package = Join-Path $downloadDirectory $filename
if (!(Test-Path -LiteralPath $package)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://swupdate.openvpn.org/community/releases/$filename" -OutFile $package
}
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Empreinte OpenVPN differente du paquet officiel verifie pour ce pilote.' }
$signature = Get-AuthenticodeSignature -LiteralPath $package
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -ne 'OpenVPN Inc.') {
    throw 'Signature ou editeur du MSI OpenVPN non valide.'
}
Write-Output "Paquet officiel verifie : $filename (SHA-256 et signature OpenVPN Inc.)."
if (!$Install) { Write-Output 'Aucune installation realisee. Utiliser -Install pour installer le moteur et le pilote TAP avec UAC.'; exit 0 }
$existing = Join-Path $env:ProgramFiles 'OpenVPN\bin\openvpn.exe'
if (Test-Path -LiteralPath $existing) { throw 'Un moteur OpenVPN existe deja. Le verifier plutot que modifier une installation tierce.' }
# Features were inspected in the signed MSI. No GUI, automatic service or logon startup is selected.
$installLog = Join-Path $downloadDirectory 'openvpn-install.log'
$installerArgs = @('/i',('"'+$package+'"'),'/qn','/norestart','ADDLOCAL=OpenVPN,Drivers,Drivers.TAPWindows6','/L*v',('"'+$installLog+'"'))
$process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList $installerArgs
if (!$process.WaitForExit(60000)) { throw 'Installation toujours active apres 60 secondes. Ne pas lancer une seconde installation.' }
if ($process.ExitCode -notin @(0,3010)) { throw "Installation echouee ($($process.ExitCode)). Voir $installLog" }
if (!(Test-Path -LiteralPath $existing)) { throw 'Le binaire attendu est absent apres installation.' }
Write-Output "OpenVPN installe : $existing ; aucun tunnel n'a ete demarre."
if ($process.ExitCode -eq 3010) { Write-Output 'Windows demande un redemarrage avant la recette du pilote.' }
