@echo off
:: ============================================================
:: agent-platform dev launcher (Windows wrapper,极简版)
:: 仅做"找 Git Bash + 调起 start-dev.sh",无其他逻辑
:: ============================================================
for %%P in ("C:\Program Files\Git\bin\bash.exe" "%LOCALAPPDATA%\Programs\Git\bin\bash.exe") do (
    if exist %%~P (
        "%%~P" "%~dp0start-dev.sh"
        pause
        exit /b 0
    )
)
echo [ERROR] Git Bash not found in default paths.
echo         Install: https://git-scm.com/download/win
pause
exit /b 1
