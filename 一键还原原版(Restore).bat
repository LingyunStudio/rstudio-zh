@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title RStudio Desktop 一键还原官方原版工具 (零外部依赖版)
cd /d "%~dp0"

echo ====================================================================
echo   RStudio Desktop 一键还原官方原版 (Restore Original)
echo   (直接调用 RStudio 内置 Node.js 引擎，无需安装 Python 或其他环境)
echo ====================================================================
echo.

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
    echo [提示] 未能在默认路径自动检测到 RStudio。
    set /p "USER_DIR=请输入 RStudio 安装目录 (例如 D:\RStudio，可直接将文件夹拖入此窗口后回车): "
    set "USER_DIR=!USER_DIR:"=!"
    if exist "!USER_DIR!\resources\app\www\rstudio\rstudio.nocache.js" (
        set "RS_DIR=!USER_DIR!"
    ) else if exist "!USER_DIR!\www\rstudio\rstudio.nocache.js" (
        set "RS_DIR=!USER_DIR!\..\.."
    ) else (
        echo [错误] 在 "!USER_DIR!" 下未找到 RStudio 核心文件，请重新确认路径！
        echo.
        goto ASK_DIR
    )
)

if exist "!RS_DIR!\resources\app\bin\node\node.exe" (
    "!RS_DIR!\resources\app\bin\node\node.exe" "%~dp0rstudio_zh.js" restore --dir "!RS_DIR!"
) else (
    where node >nul 2>nul
    if !errorlevel! equ 0 (
        node "%~dp0rstudio_zh.js" restore --dir "!RS_DIR!"
    ) else (
        python "%~dp0rstudio_zh.py" restore --dir "!RS_DIR!"
    )
)

echo.
pause
