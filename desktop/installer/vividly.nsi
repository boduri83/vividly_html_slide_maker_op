; SPDX-License-Identifier: MPL-2.0
; Generated paths are checked by build-windows-installer.mjs. No recursive delete.
Unicode true
RequestExecutionLevel user
ManifestDPIAware true
ManifestSupportedOS all
CRCCheck on
SetCompressor /SOLID zlib
SetDatablockOptimize on
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "Win\COM.nsh"

!define APP_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BorvisStudio.Vividly"
!define MARKER "BorvisStudio.Vividly.Installation.v1"
Name "Vividly"
OutFile "@OUTFILE@"
InstallDir "$LOCALAPPDATA\Programs\Vividly"
InstallDirRegKey HKCU "${APP_KEY}" "InstallLocation"
BrandingText "Borvis Studio · Present Vividly."
Icon "@ICON@"
UninstallIcon "@ICON@"
VIProductVersion "@PE_VERSION@"
VIAddVersionKey /LANG=1042 "ProductName" "Vividly"
VIAddVersionKey /LANG=1042 "FileDescription" "Vividly Windows 설치"
VIAddVersionKey /LANG=1042 "CompanyName" "Borvis Studio"
VIAddVersionKey /LANG=1042 "FileVersion" "@VERSION@"
VIAddVersionKey /LANG=1042 "ProductVersion" "@VERSION@"
VIAddVersionKey /LANG=1042 "LegalCopyright" "Borvis Studio · 기획·제작: 보들이"
ShowInstDetails show
ShowUninstDetails show
Var StagingDir
Var BackupDir
Var HasStage
Var HasBackup
Var TargetValid
Var TargetReason
Var PreviousLocation
Var PreviousVersion
Var DesktopRequested
Var ShortcutPath
Var ShortcutMatches

!define MUI_ABORTWARNING
!define MUI_ICON "@ICON@"
!define MUI_UNICON "@ICON@"
!define MUI_WELCOMEPAGE_TITLE "Vividly 설치"
!define MUI_WELCOMEPAGE_TEXT "Present Vividly.$\r$\n$\r$\nBorvis Studio · 기획·제작: 보들이$\r$\n$\r$\n현재 Windows 사용자에게 설치합니다. 관리자 권한은 필요하지 않습니다.$\r$\n$\r$\n열려 있는 Vividly를 저장하고 닫은 뒤 진행하세요. 업데이트와 제거 시 작성한 자료·자동 복구본·연결 설정은 삭제하지 않습니다.$\r$\n$\r$\n서명되지 않은 공개 베타입니다."
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Vividly.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Vividly 실행"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "English"

@MACROS@

; NSIS GetFullPathName requires an existing filesystem entry. The Windows API
; also canonicalizes a new target, which a first installation must support.
!macro FullPath TARGET SOURCE
  System::Call 'kernel32::GetFullPathNameW(w "${SOURCE}", i ${NSIS_MAX_STRLEN}, w .r8, p 0) i.r7'
  ${If} $7 == 0
  ${OrIf} $7 >= ${NSIS_MAX_STRLEN}
    StrCpy ${TARGET} ""
  ${Else}
    StrCpy ${TARGET} "$8"
  ${EndIf}
!macroend

!macro ShortcutOwnership PREFIX
Function ${PREFIX}ShortcutOwned
  StrCpy $ShortcutMatches 0
  System::Call 'ole32::CoInitialize(p 0) i.r9'
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 != 0
    System::Call '$0->0(g "${IID_IPersistFile}", *p.r1) i.r2'
    ${If} $2 == 0
      System::Call '$1->5(w "$ShortcutPath", i 0) i.r2'
      ${If} $2 == 0
        System::Call '$0->3(w .r3, i ${NSIS_MAX_STRLEN}, p 0, i 0) i.r2'
        ${If} $2 == 0
          !insertmacro FullPath $3 "$3"
          !insertmacro FullPath $4 "$INSTDIR\Vividly.exe"
          ${If} $3 == $4
            StrCpy $ShortcutMatches 1
          ${EndIf}
        ${EndIf}
      ${EndIf}
      System::Call '$1->2()'
    ${EndIf}
    System::Call '$0->2()'
  ${EndIf}
  ${If} $9 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
FunctionEnd
!macroend
!insertmacro ShortcutOwnership ""
!insertmacro ShortcutOwnership "un."

; Return a reason without mutating files. Existing nonempty unrecognized folders
; and an existing registration at another path are never accepted as a target.
Function ValidateTarget
  StrCpy $TargetValid 0
  StrCpy $TargetReason "Vividly 전용 새 폴더를 선택하세요."
  !insertmacro FullPath $INSTDIR "$INSTDIR"
  StrLen $0 $INSTDIR
  ${If} $0 < 12
    Return
  ${EndIf}
  ReadRegStr $PreviousLocation HKCU "${APP_KEY}" "InstallLocation"
  ReadRegStr $PreviousVersion HKCU "${APP_KEY}" "DisplayVersion"
  ${If} $PreviousLocation != ""
    !insertmacro FullPath $PreviousLocation "$PreviousLocation"
    ${If} $PreviousLocation != $INSTDIR
      StrCpy $TargetReason "이미 설치된 Vividly의 폴더를 선택하세요. 다른 위치에 설치하려면 기존 설치를 먼저 제거하세요."
      Return
    ${EndIf}
  ${Else}
    ReadRegStr $0 HKCU "${APP_KEY}" "DisplayName"
    ${If} $0 != ""
      StrCpy $TargetReason "기존 등록을 안전하게 확인할 수 없습니다. Windows의 설치된 앱을 먼저 확인하세요."
      Return
    ${EndIf}
    IfFileExists "$SMPROGRAMS\Borvis Studio\Vividly.lnk" 0 shortcut_clear
      StrCpy $TargetReason "동일한 이름의 기존 시작 메뉴 바로가기가 있습니다. 기존 항목을 확인한 뒤 다시 시도하세요."
      Return
    shortcut_clear:
  ${EndIf}
  IfFileExists "$SMPROGRAMS\Borvis Studio\Vividly.lnk" 0 shortcut_ownership_done
    StrCpy $ShortcutPath "$SMPROGRAMS\Borvis Studio\Vividly.lnk"
    Call ShortcutOwned
    ${If} $ShortcutMatches != 1
      StrCpy $TargetReason "시작 메뉴 바로가기가 다른 앱을 가리키고 있습니다. 기존 항목을 확인한 뒤 다시 시도하세요."
      Return
    ${EndIf}
  shortcut_ownership_done:
  !insertmacro CheckStructure "$INSTDIR" invalid_structure
  IfFileExists "$INSTDIR\.vividly-installation" existing_installation
  FindFirst $0 $1 "$INSTDIR\*"
  scan_empty:
    ${If} $1 == ""
      FindClose $0
      StrCpy $TargetValid 1
      Return
    ${EndIf}
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      StrCpy $TargetReason "선택한 폴더에 다른 파일이 있습니다. 비어 있는 Vividly 전용 폴더를 선택하세요."
      Return
    ${EndIf}
    FindNext $0 $1
    Goto scan_empty
  existing_installation:
    FileOpen $0 "$INSTDIR\.vividly-installation" r
    FileRead $0 $1
    FileClose $0
    ${If} $1 != "${MARKER}"
      StrCpy $TargetReason "설치 폴더를 확인할 수 없습니다. 다른 Vividly 전용 폴더를 선택하세요."
      Return
    ${EndIf}
    ${If} $PreviousLocation != $INSTDIR
      StrCpy $TargetReason "등록되지 않은 이전 설치 폴더는 덮어쓰지 않습니다. 비어 있는 폴더를 선택하세요."
      Return
    ${EndIf}
    StrCpy $TargetValid 1
    Return
  invalid_structure:
    StrCpy $TargetReason "설치 폴더에 연결된 폴더가 있어 안전하게 변경할 수 없습니다. 일반 폴더를 선택하세요."
FunctionEnd

Function .onInit
  SetShellVarContext current
  SetRegView 64
  StrCpy $HasStage 0
  StrCpy $HasBackup 0
  StrCpy $DesktopRequested 0
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Vividly는 Windows x64용입니다."
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  Call ValidateTarget
  ${If} $TargetValid != 1
    Abort
  ${EndIf}
FunctionEnd

Function DirectoryLeave
  Call ValidateTarget
  ${If} $TargetValid != 1
    MessageBox MB_ICONSTOP "$TargetReason"
    Abort
  ${EndIf}
FunctionEnd

Function .onInstFailed
  SetOutPath "$TEMP"
  ${If} $HasStage == 1
    !insertmacro DeleteOwned "$StagingDir"
  ${EndIf}
  ; Backup files are deliberately retained after any failed rollback.
FunctionEnd

Section "Vividly (필수)" MainSection
  SectionIn RO
  Call ValidateTarget
  ${If} $TargetValid != 1
    IfSilent +2
    MessageBox MB_ICONSTOP "$TargetReason"
    SetErrorLevel 2
    Abort "$TargetReason"
  ${EndIf}
  !insertmacro CheckLocks "$INSTDIR" in_use before_extraction
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  StrCpy $StagingDir "$INSTDIR.vividly-stage-$0"
  StrCpy $BackupDir "$INSTDIR.vividly-backup-$0"
  IfFileExists "$StagingDir" unsafe_staging
  IfFileExists "$BackupDir" unsafe_staging
  ClearErrors
  CreateDirectory "$StagingDir"
  IfErrors extraction_failed
  StrCpy $HasStage 1
  SetOverwrite on
  ClearErrors
@EXTRACTION@
  IfErrors extraction_failed
  SetOutPath "$StagingDir"
  WriteUninstaller "$StagingDir\Uninstall Vividly.exe"
  IfErrors extraction_failed
  Call ValidateTarget
  ${If} $TargetValid != 1
    Goto unsafe_staging
  ${EndIf}
  !insertmacro CheckLocks "$INSTDIR" in_use before_commit
  ClearErrors
  CreateDirectory "$BackupDir"
  IfErrors extraction_failed
  StrCpy $HasBackup 1
  CreateDirectory "$INSTDIR"
  IfErrors extraction_failed
@COMMIT@
  SetOutPath "$INSTDIR"
  ; Only known removed files from explicit previous package manifests are removed.
@OBSOLETE@
  ClearErrors
  WriteRegStr HKCU "${APP_KEY}" "DisplayName" "Vividly"
  WriteRegStr HKCU "${APP_KEY}" "DisplayVersion" "@VERSION@"
  WriteRegStr HKCU "${APP_KEY}" "Publisher" "Borvis Studio"
  WriteRegStr HKCU "${APP_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${APP_KEY}" "DisplayIcon" "$INSTDIR\Vividly.exe,0"
  WriteRegStr HKCU "${APP_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall Vividly.exe$\"'
  WriteRegStr HKCU "${APP_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall Vividly.exe$\" /S'
  WriteRegStr HKCU "${APP_KEY}" "URLInfoAbout" "https://boduri83.github.io/vividly_html_slide_maker_op/"
  WriteRegDWORD HKCU "${APP_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${APP_KEY}" "NoRepair" 1
  IfErrors metadata_failed
  CreateDirectory "$SMPROGRAMS\Borvis Studio"
  CreateShortCut "$SMPROGRAMS\Borvis Studio\Vividly.lnk" "$INSTDIR\Vividly.exe" "" "$INSTDIR\Vividly.exe" 0
  IfErrors metadata_failed
  SetOutPath "$TEMP"
  !insertmacro DeleteOwned "$BackupDir"
  !insertmacro DeleteOwned "$StagingDir"
  StrCpy $HasStage 0
  StrCpy $HasBackup 0
  SetErrorLevel 0
  Goto install_done
  metadata_failed:
    ${If} $PreviousLocation == ""
      DeleteRegKey HKCU "${APP_KEY}"
      Delete "$SMPROGRAMS\Borvis Studio\Vividly.lnk"
      RMDir "$SMPROGRAMS\Borvis Studio"
    ${Else}
      WriteRegStr HKCU "${APP_KEY}" "DisplayVersion" "$PreviousVersion"
    ${EndIf}
    Goto rollback
  rollback:
@ROLLBACK@
    SetOutPath "$TEMP"
    IfSilent +2
    MessageBox MB_ICONSTOP "설치를 완료하지 못해 이전 파일 복구를 시도했습니다. Vividly와 관련 창을 닫고 다시 시도하세요.$\r$\n복구할 파일이 남으면 다음 폴더를 보존하세요:$\r$\n$BackupDir"
    SetErrorLevel 2
    Abort "파일 교체 실패: 이전 파일 복구를 시도했습니다. 백업 폴더: $BackupDir"
  in_use:
    IfSilent +2
    MessageBox MB_ICONSTOP "Vividly가 실행 중이거나 설치 파일이 사용 중입니다. 작업을 저장하고 모든 Vividly 창을 닫은 뒤 다시 설치하세요. 실행 중인 앱은 강제 종료하지 않습니다."
    SetErrorLevel 2
    Abort "Vividly 실행 중 또는 파일 사용 중: 저장 후 앱을 닫고 다시 시도하세요."
  unsafe_staging:
    IfSilent +2
    MessageBox MB_ICONSTOP "설치 폴더가 변경되었거나 임시 폴더가 이미 있습니다. 이전 파일을 보존하고 새 전용 폴더에서 다시 시도하세요."
    SetErrorLevel 2
    Abort "설치 폴더를 안전하게 준비하지 못했습니다."
  extraction_failed:
    IfSilent +2
    MessageBox MB_ICONSTOP "새 파일을 준비하지 못했습니다. 저장 공간과 폴더 쓰기 권한을 확인하세요. 기존 설치 파일은 교체하지 않았습니다."
    SetErrorLevel 2
    Abort "설치 파일 준비 실패"
  install_done:
SectionEnd

Section /o "바탕 화면 바로가기" DesktopSection
  IfFileExists "$DESKTOP\Vividly.lnk" 0 desktop_create
  StrCpy $ShortcutPath "$DESKTOP\Vividly.lnk"
  Call ShortcutOwned
  ${If} $ShortcutMatches != 1
    Goto desktop_keep
  ${EndIf}
  desktop_create:
  ClearErrors
  CreateShortCut "$DESKTOP\Vividly.lnk" "$INSTDIR\Vividly.exe" "" "$INSTDIR\Vividly.exe" 0
  IfErrors desktop_failed
  FileOpen $0 "$INSTDIR\.vividly-installer\desktop-shortcut" w
  IfErrors desktop_failed
  FileWrite $0 "${MARKER}"
  FileClose $0
  Goto desktop_done
  desktop_keep:
    DetailPrint "기존 바탕 화면 바로가기를 보존했습니다. 시작 메뉴에서 Vividly를 실행하세요."
    Goto desktop_done
  desktop_failed:
    DetailPrint "바탕 화면 바로가기를 만들지 못했습니다. 시작 메뉴에서 Vividly를 실행하세요."
    IfSilent +2
    MessageBox MB_ICONEXCLAMATION "바탕 화면 바로가기를 만들지 못했습니다. 앱 설치는 완료되었으므로 시작 메뉴에서 Vividly를 실행하세요."
  desktop_done:
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ReadRegStr $0 HKCU "${APP_KEY}" "InstallLocation"
  !insertmacro FullPath $0 "$0"
  !insertmacro FullPath $INSTDIR "$INSTDIR"
  ${If} $0 != $INSTDIR
    IfSilent +2
    MessageBox MB_ICONSTOP "현재 등록된 Vividly 설치 위치가 아닙니다. Windows 설정의 설치된 앱에서 제거하세요."
    SetErrorLevel 2
    Quit
  ${EndIf}
  IfFileExists "$INSTDIR\.vividly-installation" 0 invalid_uninstall
  FileOpen $0 "$INSTDIR\.vividly-installation" r
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "${MARKER}" 0 invalid_uninstall
  !insertmacro CheckStructure "$INSTDIR" invalid_uninstall
  !insertmacro CheckLocks "$INSTDIR" uninstall_in_use uninstaller
  Return
  invalid_uninstall:
    IfSilent +2
    MessageBox MB_ICONSTOP "설치 폴더를 확인할 수 없어 제거하지 않았습니다. 파일과 사용자 자료를 보존했습니다."
    SetErrorLevel 2
    Quit
  uninstall_in_use:
    IfSilent +2
    MessageBox MB_ICONSTOP "Vividly가 실행 중이거나 파일이 사용 중입니다. 작업을 저장하고 앱을 닫은 뒤 제거하세요."
    SetErrorLevel 2
    Quit
FunctionEnd

Section "Uninstall"
  ; Documents, %APPDATA%, %LOCALAPPDATA% userData and recovery are not targeted.
  SetOutPath "$TEMP"
  IfFileExists "$INSTDIR\.vividly-installer\desktop-shortcut" 0 desktop_uninstall_done
  StrCpy $ShortcutPath "$DESKTOP\Vividly.lnk"
  Call un.ShortcutOwned
  ${If} $ShortcutMatches == 1
    Delete "$DESKTOP\Vividly.lnk"
  ${EndIf}
  desktop_uninstall_done:
  Delete "$INSTDIR\.vividly-installer\desktop-shortcut"
  StrCpy $ShortcutPath "$SMPROGRAMS\Borvis Studio\Vividly.lnk"
  Call un.ShortcutOwned
  ${If} $ShortcutMatches == 1
    Delete "$SMPROGRAMS\Borvis Studio\Vividly.lnk"
  ${EndIf}
  RMDir "$SMPROGRAMS\Borvis Studio"
@UNINSTALL@
  Delete "$INSTDIR\.vividly-installation"
  Delete "$INSTDIR\Uninstall Vividly.exe"
  !insertmacro RemoveEmptyDirectories "$INSTDIR"
  ; Unknown files in the installation folder remain; only empty folders vanish.
  DeleteRegKey HKCU "${APP_KEY}"
  SetErrorLevel 0
  Goto uninstall_done
  uninstall_failed:
    IfSilent +2
    MessageBox MB_ICONSTOP "사용 중인 일부 파일을 제거하지 못했습니다. 남은 파일과 사용자 자료를 보존했습니다. 관련 창을 닫고 이 제거 프로그램을 다시 실행하세요."
    SetErrorLevel 2
  uninstall_done:
SectionEnd
