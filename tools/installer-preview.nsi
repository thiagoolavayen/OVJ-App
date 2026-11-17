; Preliminary per-user installer. No substituted logo and no elevated helper.
; Uses an exact generated manifest for uninstall; never RMDir /r $INSTDIR.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "nsDialogs.nsh"

; Monochrome identity: native controls retain Windows keyboard/accessibility
; behavior. No bitmap, alternate shield or decorative stock sidebar is used.
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "000000"
!define MUI_INSTFILESPAGE_COLORS "000000 F2F2F2"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth colored"
!if /FileExists "${PROJECT_DIR}/assets/icon.ico"
  !ifndef MUI_ICON
    !define MUI_ICON "${PROJECT_DIR}/assets/icon.ico"
  !endif
  !ifndef MUI_UNICON
    !define MUI_UNICON "${PROJECT_DIR}/assets/icon.ico"
  !endif
!endif

!if "$%OVJ_PREVIEW_UNPACKED_DIR%" == ""
  !error "Set OVJ_PREVIEW_UNPACKED_DIR to the verified win-unpacked directory."
!endif
!if "$%OVJ_PREVIEW_UNINSTALL_MANIFEST%" == ""
  !error "Generate and set OVJ_PREVIEW_UNINSTALL_MANIFEST before packaging."
!endif

; Requires the pinned NSIS 3.12 toolset. Finalizing before embedding forces a
; complete uninstaller, avoiding deltas tied to the installer's icon offsets.
; The script validates the manifest and applies the same original/no-icon policy.
!if "$%OVJ_PREVIEW_NODE_PATH%" == ""
  !define OVJ_BUILD_NODE "node"
!else
  !define OVJ_BUILD_NODE "$%OVJ_PREVIEW_NODE_PATH%"
!endif
!uninstfinalize '"${OVJ_BUILD_NODE}" "${PROJECT_DIR}/tools/finalize-uninstaller.cjs" "%1" "${VERSION}"' = 0

Name "OVJ App"
Caption "OVJ App · Ovejeros FC"
BrandingText "Ovejeros FC"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\OVJ App"
InstallDirRegKey HKCU "Software\Ovejeros FC\OVJ App Preview" "InstallDir"
ShowInstDetails show
ShowUninstDetails show
CRCCheck on

; Ownership token, independent of app version. Keep it stable for upgrades from
; 0.1.0 so the current installation remains a valid destination/uninstall root.
!define OVJ_MARKER "OVJ-App-Preview-Install-0.1.0"
!define OVJ_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OVJAppPreview"
!define MUI_ABORTWARNING
Page custom OVJWelcomePage
!define MUI_PAGE_HEADER_TEXT "OVJ App"
!define MUI_PAGE_HEADER_SUBTEXT "Ovejeros FC · Carpeta de instalación"
!define MUI_DIRECTORYPAGE_TEXT_TOP "Elegí una carpeta para OVJ App. La instalación es para tu usuario de Windows y conserva tus preferencias."
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "OVJ App instalado"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Ovejeros FC · Ya podés abrir OVJ App desde sus accesos directos."
!insertmacro MUI_PAGE_INSTFILES
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Se desinstalará OVJ App. Tus preferencias y los datos de HaxBall se conservarán."
!insertmacro MUI_UNPAGE_CONFIRM
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "OVJ App desinstalado"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Ovejeros FC · Tus preferencias se conservaron."
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro addLangs

Function OVJWelcomePage
  !insertmacro MUI_HEADER_TEXT "OVJ App" "Ovejeros FC"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  SetCtlColors $0 "000000" "F2F2F2"
  ${NSD_CreateLabel} 0u 8u 100% 24u "OVJ App"
  Pop $1
  CreateFont $2 "Segoe UI" 18 700
  SendMessage $1 ${WM_SETFONT} $2 1
  SetCtlColors $1 "000000" "F2F2F2"
  ${NSD_CreateLabel} 0u 40u 100% 16u "Ovejeros FC · HaxBall"
  Pop $1
  SetCtlColors $1 "303030" "F2F2F2"
  ${NSD_CreateLabel} 0u 68u 100% 44u "Cerrá OVJ App antes de instalar o actualizar.$\r$\n$\r$\nLa aplicación se instalará para tu usuario de Windows."
  Pop $1
  SetCtlColors $1 "000000" "F2F2F2"
  nsDialogs::Show
  System::Call 'gdi32::DeleteObject(p r2)'
FunctionEnd

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "OVJ App requiere Windows de 64 bits."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

; An existing directory is allowed only when it is empty or bears our marker.
; This prevents installing into a broad nonempty folder such as Documents.
Function .onVerifyInstDir
  IfFileExists "$INSTDIR\.ovj-installation" owned
  IfFileExists "$INSTDIR\*" 0 accepted
  FindFirst $0 $1 "$INSTDIR\*"
  loop:
    StrCmp $1 "" acceptedClose
    StrCmp $1 "." next
    StrCmp $1 ".." next
    FindClose $0
    Abort
  next:
    FindNext $0 $1
    Goto loop
  acceptedClose:
    FindClose $0
    Goto accepted
  owned:
    FileOpen $0 "$INSTDIR\.ovj-installation" r
    IfErrors rejected
    FileRead $0 $1
    FileClose $0
    StrCmp $1 "${OVJ_MARKER}" accepted
  rejected:
    Abort
  accepted:
FunctionEnd

Section "OVJ App" InstallApp
  SetShellVarContext current
  SetRegView 64
  ; Calls also protect silent installs from an unsafe existing directory.
  Call .onVerifyInstDir
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "$%OVJ_PREVIEW_FILE_GLOB%"
  FileOpen $0 "$INSTDIR\.ovj-installation" w
  FileWrite $0 "${OVJ_MARKER}"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall OVJ App.exe"
  CreateDirectory "$SMPROGRAMS\OVJ App"
  CreateShortcut "$SMPROGRAMS\OVJ App\OVJ App.lnk" "$INSTDIR\OVJ App.exe"
  CreateShortcut "$DESKTOP\OVJ App.lnk" "$INSTDIR\OVJ App.exe"
  WriteRegStr HKCU "Software\Ovejeros FC\OVJ App Preview" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${OVJ_UNINSTALL_KEY}" "DisplayName" "OVJ App (preliminar)"
  WriteRegStr HKCU "${OVJ_UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${OVJ_UNINSTALL_KEY}" "Publisher" "Ovejeros FC"
  WriteRegStr HKCU "${OVJ_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${OVJ_UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall OVJ App.exe$\"'
  WriteRegStr HKCU "${OVJ_UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall OVJ App.exe$\" /S'
  WriteRegDWORD HKCU "${OVJ_UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${OVJ_UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ; Never trust a caller-supplied _?= directory without our ownership marker.
  FileOpen $0 "$INSTDIR\.ovj-installation" r
  IfErrors denied
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "${OVJ_MARKER}" valid
  denied:
    MessageBox MB_ICONSTOP|MB_OK "No se encontró una instalación válida de OVJ App en esta carpeta."
    Abort
  valid:
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  ; Literal package-owned files only, then empty package directories.
  !include "$%OVJ_PREVIEW_UNINSTALL_MANIFEST%"
  Delete "$INSTDIR\.ovj-installation"
  Delete "$INSTDIR\Uninstall OVJ App.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\OVJ App.lnk"
  Delete "$SMPROGRAMS\OVJ App\OVJ App.lnk"
  RMDir "$SMPROGRAMS\OVJ App"
  DeleteRegKey HKCU "${OVJ_UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\Ovejeros FC\OVJ App Preview"
  ; Preferences and HaxBall data in APPDATA are deliberately retained.
  Goto ovjUninstallComplete
  ovjUninstallFilesBusy:
    MessageBox MB_ICONSTOP|MB_OK "No se pudieron eliminar todos los archivos. Cerrá OVJ App y volvé a ejecutar el desinstalador."
    Abort
  ovjUninstallComplete:
SectionEnd
