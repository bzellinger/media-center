@echo off
rem Starts the Media Center helper and opens the app full screen in Microsoft Edge.
rem Close the app with Alt+F4. The small "Media Center helper" window can be closed afterwards.
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  start "Media Center helper" /min py -3 tools\serve.py
) else (
  start "Media Center helper" /min python tools\serve.py
)

rem give the helper a moment to start
timeout /t 2 /nobreak >nul

rem Edge in full-screen "app" mode (no address bar or tabs) with its own storage folder, kept
rem next to this file in "browser-data". That is where your settings live, so they survive
rem closing the app and restarting the PC, and it never mixes with your everyday Edge.
rem (Edge's kiosk mode was used before; it is always private and forgot settings on close.)
start "" msedge --user-data-dir="%~dp0browser-data" --app="http://127.0.0.1:8765/" --start-fullscreen --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required
