@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title RStudio Desktop Chinese Localization Installer
cd /d "%~dp0"

set "RS_DIR="

if /i "%~1"=="--dir" (
    if not "%~2"=="" set "RS_DIR=%~2"
) else if not "%~1"=="" (
    if exist "%~1\resources\app\www\rstudio\rstudio.nocache.js" set "RS_DIR=%~1"
)

if "!RS_DIR!"=="" (
    for %%D in (
        "%ProgramFiles%\RStudio"
        "%LOCALAPPDATA%\Programs\RStudio"
        "D:\RStudio"
        "C:\RStudio"
        "E:\RStudio"
        "F:\RStudio"
        "%ProgramFiles(x86)%\RStudio"
    ) do (
        if exist "%%~D\resources\app\www\rstudio\rstudio.nocache.js" (
            if "!RS_DIR!"=="" set "RS_DIR=%%~D"
        )
    )
)

if "!RS_DIR!"=="" (
    for %%K in (
        "HKLM\SOFTWARE\RStudio"
        "HKCU\SOFTWARE\RStudio"
        "HKLM\SOFTWARE\WOW6432Node\RStudio"
        "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\RStudio"
    ) do (
        for /f "tokens=2*" %%A in ('reg query "%%~K" /v Path 2^>nul ^| findstr /i "REG_"') do (
            if exist "%%~B\resources\app\www\rstudio\rstudio.nocache.js" set "RS_DIR=%%~B"
        )
        for /f "tokens=2*" %%A in ('reg query "%%~K" /v InstallLocation 2^>nul ^| findstr /i "REG_"') do (
            if exist "%%~B\resources\app\www\rstudio\rstudio.nocache.js" set "RS_DIR=%%~B"
        )
    )
)

:ASK_DIR
if "!RS_DIR!"=="" (
    echo [INFO] RStudio was not found in default locations.
    set /p "USER_DIR=Please enter your RStudio folder path (e.g. D:\RStudio): "
    set "USER_DIR=!USER_DIR:"=!"
    if exist "!USER_DIR!\resources\app\www\rstudio\rstudio.nocache.js" (
        set "RS_DIR=!USER_DIR!"
    ) else if exist "!USER_DIR!\www\rstudio\rstudio.nocache.js" (
        set "RS_DIR=!USER_DIR!\..\.."
    ) else (
        echo [ERROR] Could not find RStudio in "!USER_DIR!". Please try again.
        echo.
        goto ASK_DIR
    )
)

if exist "!RS_DIR!\resources\app\bin\node\node.exe" (
    "!RS_DIR!\resources\app\bin\node\node.exe" "%~dp0rstudio_zh.js" install --dir "!RS_DIR!"
) else (
    where node >nul 2>nul
    if !errorlevel! equ 0 (
        node "%~dp0rstudio_zh.js" install --dir "!RS_DIR!"
    ) else (
        python "%~dp0rstudio_zh.py" install --dir "!RS_DIR!"
    )
)

echo.
pause
