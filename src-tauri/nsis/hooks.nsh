; Uninstall hooks for the NSIS installer.
;
; The inbox and the log are created by the app at runtime, so the installer
; never recorded them and the default uninstaller would leave them behind.

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$LOCALAPPDATA\Tute\inbox"
  Delete "$LOCALAPPDATA\Tute\tute.log"
!macroend
