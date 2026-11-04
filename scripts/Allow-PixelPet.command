#!/bin/bash
# Removes download quarantine only from the installed Pixel Pet app.
# Run manually after installing a trusted Pixel Pet release.
set -u

PET_APP="/Applications/Pixel Pet.app"
PET_BUNDLE_ID="com.kevinmuyaoguo.pixelpet"
PET_TERMINAL_TTY=$(/usr/bin/tty 2>/dev/null || true)

close_script_terminal() {
  # Match this session by TTY. Never close a window containing other tabs.
  [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ] || return 0
  case "$PET_TERMINAL_TTY" in /dev/ttys*) ;; *) return 0 ;; esac
  /usr/bin/osascript - "$PET_TERMINAL_TTY" >/dev/null 2>&1 <<'APPLESCRIPT' &
on run argv
  set targetTTY to item 1 of argv
  repeat 40 times
    tell application "Terminal"
      repeat with terminalWindow in windows
        repeat with terminalTab in tabs of terminalWindow
          if tty of terminalTab is targetTTY then
            if (count of tabs of terminalWindow) is not 1 then return
            if not busy of terminalTab then
              close terminalWindow saving no
              if (count of windows) is 0 then quit
              return
            end if
          end if
        end repeat
      end repeat
    end tell
    delay 0.25
  end repeat
end run
APPLESCRIPT
}

trap close_script_terminal EXIT

show_message() {
  /usr/bin/osascript - "$1" <<'APPLESCRIPT'
on run argv
  display dialog (item 1 of argv) with title "Pixel Pet" buttons {"好 / OK"} default button 1
end run
APPLESCRIPT
}

if [ ! -d "$PET_APP" ]; then
  show_message "请先打开 DMG，将 Pixel Pet.app 拖到 Applications 文件夹，再运行此脚本。\nInstall Pixel Pet.app in Applications first."
  exit 1
fi

pet_actual_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PET_APP/Contents/Info.plist" 2>/dev/null)
if [ "$pet_actual_id" != "$PET_BUNDLE_ID" ]; then
  show_message "应用标识不匹配，操作已取消。\nThe app identifier does not match Pixel Pet. No changes made."
  exit 1
fi

if ! /usr/bin/osascript <<'APPLESCRIPT'
display dialog "此操作仅移除 /Applications/Pixel Pet.app 的下载隔离标记，可能让 macOS 不再拦截此应用。请仅在确认安装包来自可信来源时继续。不会关闭全局 Gatekeeper，也不会对应用签名或进行安全扫描。\n\nThis removes download quarantine from Pixel Pet only. Continue only if you trust this release." with title "Pixel Pet" buttons {"取消 / Cancel", "继续 / Continue"} default button 1 cancel button 1 with icon caution
APPLESCRIPT
then
  exit 0
fi

if pet_error=$(/usr/bin/xattr -dr com.apple.quarantine "$PET_APP" 2>&1); then
  show_message "处理完成，现在可以打开 Pixel Pet。\nDone. You can now open Pixel Pet."
else
  printf '%s\n' "$pet_error" >&2
  show_message "未能完成操作，请确认当前账户有权修改此应用。\nCould not update Pixel Pet.\n\n$pet_error"
  exit 1
fi
