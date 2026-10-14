@echo off
echo ============================================
echo  M365 Calendar Permission Manager
echo ============================================
echo.

:: Install ExchangeOnlineManagement, or update it if older than 3.7.2 (needed for -DisableWAM sign-in)
powershell -NoProfile -Command ^
  "$m = Get-Module -ListAvailable -Name ExchangeOnlineManagement | Sort-Object Version -Descending | Select-Object -First 1; if (-not $m) { Write-Host 'Installing ExchangeOnlineManagement...' -ForegroundColor Yellow; Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop; Write-Host 'Done.' -ForegroundColor Green } elseif ($m.Version -lt [version]'3.7.2') { Write-Host ('Updating ExchangeOnlineManagement ' + $m.Version + '...') -ForegroundColor Yellow; Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop; Write-Host 'Done.' -ForegroundColor Green } else { Write-Host ('ExchangeOnlineManagement ' + $m.Version + ' already installed.') -ForegroundColor Green }"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Module installation failed.
    echo Try running as Administrator or check your internet connection.
    pause
    exit /b 1
)

echo.
echo Launching...
echo.

:: Run the GUI; keep the window open on error so the user can read the message
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { & '%~dp0Set-CalendarPermissions-GUI.ps1' } catch { Write-Host 'ERROR: ' $_.Exception.Message -ForegroundColor Red; Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor Yellow; Read-Host 'Press Enter to close' }"
