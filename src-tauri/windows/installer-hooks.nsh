; AutoClip NSIS hooks (tauri.windows.conf.json -> bundle.windows.nsis.installerHooks)
;
; Stop leftover python.exe, ffmpeg.exe, and ffprobe.exe processes from the installation directory before upgrades or uninstalls.
; Versions 1.4.0 and earlier had no Job Object, so backend processes could outlive the app,
; keep resources\python\*.pyd files open, and cause the installer to fail writing _asyncio.pyd (#224).
; The Job Object only helps new runtimes; upgrades run through the user's old version, so the installer must handle cleanup.
;
; Match executable paths against the install directory so the user's own Python / ffmpeg processes are not stopped.
; Pass the install directory to PowerShell through an environment variable to avoid parsing special path characters.
; NSIS strings use backticks; $$ represents a literal $ in NSIS.

!macro AUTOVIDEOCLIP_KILL_BUNDLED_PROCESSES
  System::Call 'Kernel32::SetEnvironmentVariable(t "AUTOVIDEOCLIP_INSTDIR", t "$INSTDIR")i'
  nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$root = [IO.Path]::GetFullPath($$env:AUTOVIDEOCLIP_INSTDIR).TrimEnd([char]92) + [char]92; Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$root, [StringComparison]::OrdinalIgnoreCase) -and @('python.exe','pythonw.exe','ffmpeg.exe','ffprobe.exe') -contains $$_.Name.ToLower() } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  ; Give the system time to release file handles.
  Sleep 800
!macroend

; The Tauri template calls PREINSTALL / PREUNINSTALL before checking whether the app is running (CheckIfAppIsRunning).
; If a hook stops the backend before the app exits, cancelling the dialog or Restart Manager failing
; to close the app in another session can leave the UI running with a dead backend (RC156 Win QA #4).
; Check that the app has exited before cleaning up. The template's later process check then finds nothing to stop.
; CheckIfAppIsRunning comes from the included utils.nsh; its labels are insertion-point-specific and may be reused.

; Upgrades write the current version's files but do not clean the directory. Backend source files removed in a newer
; version can remain under resources\backend and still be imported (RC156 Win QA #2). After the app and its processes
; have exited, remove that directory before the template writes the current version's files.
; Only remove backend source from the install directory. User data (projects, settings, logs, Whisper runtime and models)
; under %APPDATA%\AutoClip is untouched. PYTHONDONTWRITEBYTECODE=1 prevents runtime-generated files here.
; Do not remove resources\python wholesale: it is large and may contain files locked as described in #224.
!macro AUTOVIDEOCLIP_REMOVE_OLD_BACKEND
  ${If} "$INSTDIR" != ""
  ${AndIf} ${FileExists} "$INSTDIR\resources\backend\*.*"
    RMDir /r "$INSTDIR\resources\backend"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro AUTOVIDEOCLIP_KILL_BUNDLED_PROCESSES
  !insertmacro AUTOVIDEOCLIP_REMOVE_OLD_BACKEND
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro AUTOVIDEOCLIP_KILL_BUNDLED_PROCESSES
!macroend

; Delete user data during uninstall only when requested (RC156 Win QA #15). The template's "delete app data" checkbox
; removes only $APPDATA\com.autovideoclip.desktop and $LOCALAPPDATA\com.autovideoclip.desktop (WebView data), leaving
; %APPDATA%\AutoClip, which contains projects, settings, and API keys. This conflicts with the privacy notice.
; Silent /DELETEAPPDATA does not use the template's checkbox branch. It previously removed %APPDATA%\AutoClip
; but left WebView data behind (RC156 Win QA #24). Remove the same three directories here; if the GUI checkbox
; already removed its two directories, FileExists is false and this code leaves them alone.
; This destructive operation runs only when every condition is met, and only removes these three fixed directories
; (no wildcards and no parent directories):
;   - Never during updates: the template's /UPDATE ($UpdateMode = 1) is excluded.
;   - Never during the installer's pre-install uninstall: a user-run uninstaller copies itself to %TEMP% first,
;     while the installer uses _?= in place ($EXEDIR = $INSTDIR).
;   - In GUI mode, honor the checkbox (unchecked by default; unchecked means keep the data).
;   - Silent (/S) or passive (/P) mode has no checkbox; require the explicit /DELETEAPPDATA flag.
!macro AUTOVIDEOCLIP_DELETE_USER_DATA
  Push $R8
  Push $R9
  StrCpy $R9 0
  ${If} $UpdateMode <> 1
  ${AndIf} "$EXEDIR" != "$INSTDIR"
    ${If} ${Silent}
    ${OrIf} $PassiveMode = 1
      ClearErrors
      ${GetOptions} $CMDLINE "/DELETEAPPDATA" $R8
      ${IfNot} ${Errors}
        StrCpy $R9 1
      ${EndIf}
    ${ElseIf} $DeleteAppDataCheckboxState = 1
      StrCpy $R9 1
    ${EndIf}
  ${EndIf}
  ${If} $R9 = 1
    SetShellVarContext current
    ${If} "$APPDATA" != ""
    ${AndIf} ${FileExists} "$APPDATA\AutoClip\*.*"
      DetailPrint "Deleting AutoClip data: $APPDATA\AutoClip"
      RMDir /r "$APPDATA\AutoClip"
    ${EndIf}
    ${If} "$APPDATA" != ""
    ${AndIf} ${FileExists} "$APPDATA\${BUNDLEID}\*.*"
      RMDir /r "$APPDATA\${BUNDLEID}"
    ${EndIf}
    ${If} "$LOCALAPPDATA" != ""
    ${AndIf} ${FileExists} "$LOCALAPPDATA\${BUNDLEID}\*.*"
      DetailPrint "Deleting WebView data: $LOCALAPPDATA\${BUNDLEID}"
      RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
    ${EndIf}
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend

; The install directory could remain after uninstall (RC156 Win QA #23): bytecode generated by bundled Python
; (for example resources\python\Lib\encodings\__pycache__\gbk.cpython-313.pyc) is not in the install manifest.
; The template deletes manifest files and then removes directories non-recursively, leaving the resources\python
; tree and install directory behind. Once manifest files are removed, the three bundled resource directories can
; contain only runtime-generated files, so remove those directories recursively; remove resources and the install
; directory itself non-recursively so any other contents are preserved.
;   - Only touch the three bundled directories under $INSTDIR\resources (matching tauri.windows.conf.json);
;     do not use wildcards or touch %APPDATA% / %LOCALAPPDATA%.
;   - Skip updates (/UPDATE) and the installer's pre-install uninstall ($EXEDIR = $INSTDIR), since a new version
;     is about to be installed in place. resources\python may contain files locked as described in #224; PREINSTALL
;     only clears resources\backend.
!macro AUTOVIDEOCLIP_REMOVE_INSTALL_LEFTOVERS
  ${If} $UpdateMode <> 1
  ${AndIf} "$EXEDIR" != "$INSTDIR"
  ${AndIf} "$INSTDIR" != ""
  ${AndIfNot} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    RMDir /r "$INSTDIR\resources\python"
    RMDir /r "$INSTDIR\resources\backend"
    RMDir /r "$INSTDIR\resources\ffmpeg"
    RMDir "$INSTDIR\resources"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro AUTOVIDEOCLIP_DELETE_USER_DATA
  !insertmacro AUTOVIDEOCLIP_REMOVE_INSTALL_LEFTOVERS
!macroend

; Confirmation-page note: data is kept by default and permanently deleted only when selected (text is in windows/lang/*.nsh).
; This hook is included before the template defines its pages; MUI_UNPAGE_CONFIRM reads and clears this definition.
!define MUI_UNCONFIRMPAGE_TEXT_TOP "$(autovideoclipUninstallNote)"
