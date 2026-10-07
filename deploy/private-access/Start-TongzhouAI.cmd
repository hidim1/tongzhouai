@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0Start-TongzhouAI.ps1"
if errorlevel 1 (
  echo.
  echo If PowerShell script execution is blocked, use this native OpenSSH command:
  echo ssh -F NUL -N -o "UserKnownHostsFile=%~dp0ssh-known-hosts" -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:14318:127.0.0.1:4318 root@36.140.247.61
  echo Then visit http://127.0.0.1:14318 in your browser. Keep the SSH window open.
)
pause
