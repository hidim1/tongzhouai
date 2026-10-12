Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Name "舟知"
OutFile "Zhouzhi-V1.0-Windows-x64-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Zhouzhi"
RequestExecutionLevel user
SetCompressor /SOLID zlib
VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=2052 "ProductName" "舟知"
VIAddVersionKey /LANG=2052 "FileDescription" "舟知 V1.0 安装程序"
VIAddVersionKey /LANG=2052 "CompanyName" "同舟纵横"
VIAddVersionKey /LANG=2052 "LegalCopyright" "同舟纵横"
VIAddVersionKey /LANG=2052 "FileVersion" "1.0.0.0"
Icon "icon.ico"
UninstallIcon "icon.ico"
!define MUI_ABORTWARNING
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_WELCOMEPAGE_TITLE "欢迎安装舟知"
!define MUI_WELCOMEPAGE_TEXT "舟知 · 全量工作助手$\r$\n$\r$\n安装完成后，使用管理员发放的账号、密码和单次激活码开始工作。$\r$\n$\r$\n需要连接网络。当前为未加密内测连接，请仅在可信网络使用。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\舟知.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动舟知"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "舟知"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "win-unpacked/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\舟知"
  ; An explicit, separate company icon avoids the old Electron shortcut cache.
  CreateShortCut "$DESKTOP\舟知.lnk" "$INSTDIR\舟知.exe" "" "$INSTDIR\zhouzhi-crossflow-v1.ico" 0
  CreateShortCut "$SMPROGRAMS\舟知\舟知.lnk" "$INSTDIR\舟知.exe" "" "$INSTDIR\zhouzhi-crossflow-v1.ico" 0
  CreateShortCut "$SMPROGRAMS\舟知\卸载舟知.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\zhouzhi-crossflow-v1.ico" 0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember" "DisplayName" "舟知"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember" "Publisher" "同舟纵横"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember" "DisplayIcon" "$INSTDIR\zhouzhi-crossflow-v1.ico,0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember" "NoRepair" 1
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  ${If} $INSTDIR != "$LOCALAPPDATA\Programs\Zhouzhi"
    MessageBox MB_ICONSTOP "安装目录不匹配，已停止卸载。"
    Abort
  ${EndIf}
  Delete "$DESKTOP\舟知.lnk"
  Delete "$SMPROGRAMS\舟知\舟知.lnk"
  Delete "$SMPROGRAMS\舟知\卸载舟知.lnk"
  RMDir "$SMPROGRAMS\舟知"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhouzhiMember"
  ; AppData/舟知 installation identity is retained for same-device reinstall.
SectionEnd
