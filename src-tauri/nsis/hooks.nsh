; Extra steps for Tute's uninstaller.
;
; Tute makes these itself while it runs, so the installer never listed them and
; a plain uninstall would leave them behind: the dropped-file inbox, Claude's
; task files ("Do it with Claude"), the browser extension's folder and the log.
; Settings (in %APPDATA%) and the keys in the Credential Manager stay, as
; Windows apps usually leave them.

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$LOCALAPPDATA\Tute\inbox"
  RMDir /r "$LOCALAPPDATA\Tute\tasks"
  RMDir /r "$LOCALAPPDATA\Tute\extension"
  Delete "$LOCALAPPDATA\Tute\tute.log"
!macroend
