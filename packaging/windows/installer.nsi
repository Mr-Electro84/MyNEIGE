Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!ifndef PAYLOAD
 !error "PAYLOAD missing"
!endif
Name "MyNEIGE ${APP_VERSION}"
OutFile "${OUTPUT}"
InstallDir "$PROGRAMFILES64\MyNEIGE"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32
ShowInstDetails show
ShowUninstDetails show
BrandingText "Matra DevProd - MyNEIGE Alpha"
Icon "${PAYLOAD}\assets\myneige.ico"
UninstallIcon "${PAYLOAD}\assets\myneige.ico"
VIProductVersion "${WIN_VERSION}"
VIAddVersionKey /LANG=1036 "ProductName" "MyNEIGE"
VIAddVersionKey /LANG=1036 "CompanyName" "Matra DevProd"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de MyNEIGE Alpha"
VIAddVersionKey /LANG=1036 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "Matra DevProd - Apache-2.0"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "MyNEIGE Alpha pour Windows 11 x64.$\r$\n$\r$\nLe programme inclut Electron, sans profil VPN. Importez votre propre profil universitaire au premier lancement. OpenVPN Community/TAP sera vérifié et pourra être installé séparément avec votre accord.$\r$\n$\r$\nFermez MyNEIGE avant une installation, mise à jour ou désinstallation."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE"
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "MyNEIGE est installé.$\r$\n$\r$\nLancez-le depuis le menu Démarrer, sans l'exécuter en tant qu'administrateur. Le contrôleur demandera l'élévation nécessaire.$\r$\n$\r$\nVersion Alpha : mises à jour manuelles."
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "MyNEIGE sera désinstallé. Les données locales et identifiants mémorisés seront conservés.$\r$\n$\r$\nPour les effacer, annulez puis utilisez « MyNEIGE - Effacer les données locales » dans le menu Démarrer avant de désinstaller.$\r$\n$\r$\nOpenVPN et les autres VPN seront conservés."
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "French"

Var MaintenanceMutex
Var SessionMutex
Var UpgradeMutex
!macro AcquireNativeSession
  System::Call 'kernel32::CreateMutexW(p0, i1, w "Global\MyNEIGE-PoC-Session-v1") p.r0 ?e'
  Pop $1
  ${If} $0 == 0
  ${OrIf} $1 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Une session MyNEIGE est active. Fermez-la avant de continuer." /SD IDOK
    SetErrorLevel 3
    Quit
  ${EndIf}
  StrCpy $SessionMutex $0
!macroend
!macro AcquireMaintenance PREFIX
  ; Deny replacement while the launcher, another installer or native session runs.
  System::Call 'kernel32::CreateMutexW(p0, i1, w "Global\MyNEIGE-Desktop-v1") p.r0 ?e'
  Pop $1
  ${If} $0 == 0
  ${OrIf} $1 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "MyNEIGE ou son installateur est en cours. Fermez-le avant de continuer." /SD IDOK
    SetErrorLevel 3
    Quit
  ${EndIf}
  StrCpy $MaintenanceMutex $0
  !insertmacro AcquireNativeSession
!macroend

Function .onInit
  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_OK|MB_ICONSTOP "Cette Alpha nécessite Windows x64 (Intel/AMD)." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${IfNot} ${AtLeastWin11}
    MessageBox MB_OK|MB_ICONSTOP "Cette Alpha nécessite Windows 11." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  SetRegView 64
  SetShellVarContext all
  ; Fixed protected location: /D cannot redirect an elevated installation.
  StrCpy $INSTDIR "$PROGRAMFILES64\MyNEIGE"
  ; Ce verrou reste détenu pendant le passage par l'ancien désinstalleur.
  System::Call 'kernel32::CreateMutexW(p0, i1, w "Global\MyNEIGE-Upgrade-v1") p.r0 ?e'
  Pop $1
  ${If} $0 == 0
  ${OrIf} $1 != 0
    MessageBox MB_OK|MB_ICONSTOP "Une installation MyNEIGE est déjà en cours." /SD IDOK
    SetErrorLevel 3
    Quit
  ${EndIf}
  StrCpy $UpgradeMutex $0
  !insertmacro AcquireMaintenance ""
FunctionEnd

Function RemovePreviousVersion
  ClearErrors
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "InstallLocation"
  ${IfNot} ${Errors}
    ${If} $0 != "$INSTDIR"
      MessageBox MB_OK|MB_ICONSTOP "L'ancienne installation MyNEIGE indique un emplacement inattendu. Désinstallez-la manuellement avant de continuer." /SD IDOK
      SetErrorLevel 2
      Abort
    ${EndIf}
    IfFileExists "$INSTDIR\Uninstall.exe" previous_found previous_missing
  ${EndIf}
  ; Détecter aussi une installation dont l'inscription a été perdue.
  IfFileExists "$INSTDIR\Uninstall.exe" previous_found
  IfFileExists "$INSTDIR\MyNEIGE.exe" previous_missing previous_done
previous_missing:
  MessageBox MB_OK|MB_ICONSTOP "Une ancienne installation est présente, mais son désinstalleur est introuvable. Réparez-la avant de continuer." /SD IDOK
  SetErrorLevel 2
  Abort
previous_found:
  DetailPrint "Désinstallation de la version précédente de MyNEIGE…"
  InitPluginsDir
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\Uninstall.exe" "$PLUGINSDIR\previous-uninstall.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Impossible de préparer la désinstallation précédente." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ; Les anciens désinstalleurs acquièrent eux-mêmes ces deux verrous.
  System::Call 'kernel32::CloseHandle(p $SessionMutex)'
  System::Call 'kernel32::CloseHandle(p $MaintenanceMutex)'
  StrCpy $SessionMutex 0
  StrCpy $MaintenanceMutex 0
  ClearErrors
  ; _?= doit rester le dernier argument, sans guillemets : ExecWait attend
  ; alors le vrai désinstalleur au lieu d'un processus de copie temporaire.
  ExecWait '$\"$PLUGINSDIR\previous-uninstall.exe$\" /S _?=$INSTDIR' $2
  ${If} ${Errors}
    StrCpy $2 1
  ${EndIf}
  ; Refuser toute écriture si un lanceur ou une session a démarré entre-temps.
  !insertmacro AcquireMaintenance ""
  ${If} $2 != 0
    MessageBox MB_OK|MB_ICONSTOP "La désinstallation précédente a échoué. La nouvelle version ne sera pas installée." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  IfFileExists "$INSTDIR\MyNEIGE.exe" previous_incomplete
  IfFileExists "$INSTDIR\Uninstall.exe" previous_incomplete
  ClearErrors
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "UninstallString"
  ${IfNot} ${Errors}
    Goto previous_incomplete
  ${EndIf}
  Goto previous_done
previous_incomplete:
  MessageBox MB_OK|MB_ICONSTOP "La désinstallation précédente est incomplète. Installation interrompue." /SD IDOK
  SetErrorLevel 1
  Abort
previous_done:
FunctionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext all
  ${If} $INSTDIR != "$PROGRAMFILES64\MyNEIGE"
    MessageBox MB_OK|MB_ICONSTOP "Emplacement de désinstallation invalide." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  !insertmacro AcquireMaintenance "un."
FunctionEnd

Section "MyNEIGE" SEC_MAIN
  Call RemovePreviousVersion
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${PAYLOAD}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\MyNEIGE"
  CreateShortcut "$SMPROGRAMS\MyNEIGE\MyNEIGE.lnk" "$INSTDIR\MyNEIGE.exe" "" "$INSTDIR\MyNEIGE.exe" 0
  CreateShortcut "$SMPROGRAMS\MyNEIGE\MyNEIGE - Effacer les données locales.lnk" "$INSTDIR\MyNEIGE.exe" "--reset-user-data" "$INSTDIR\MyNEIGE.exe" 0
  CreateShortcut "$SMPROGRAMS\MyNEIGE\Désinstaller MyNEIGE.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "DisplayName" "MyNEIGE Alpha"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "Publisher" "Matra DevProd"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "DisplayIcon" "$INSTDIR\MyNEIGE.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; Recovery acquires the native session mutex and removes only owned WFP/TAP.
  System::Call 'kernel32::CloseHandle(p $SessionMutex)'
  ExecWait '$\"$INSTDIR\bin\myneige-controller.exe$\" cleanup' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Le nettoyage des protections MyNEIGE a échoué. Désinstallation interrompue ; relancez-la après résolution." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ; Reacquire before deleting files, including if a development controller raced.
  !insertmacro AcquireNativeSession
  ClearErrors
  !include "${DELETE_INCLUDE}"
  ; Les RMDir peuvent échouer sur un fichier personnel conservé : vérifier
  ; explicitement les fichiers installés, sans suppression récursive.
  !include "${VERIFY_DELETE_INCLUDE}"
  Delete "$SMPROGRAMS\MyNEIGE\MyNEIGE.lnk"
  Delete "$SMPROGRAMS\MyNEIGE\MyNEIGE - Effacer les données locales.lnk"
  Delete "$SMPROGRAMS\MyNEIGE\Désinstaller MyNEIGE.lnk"
  RMDir "$SMPROGRAMS\MyNEIGE"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyNEIGE"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
