@echo off
chcp 65001 >nul
title RStudio Desktop 一键还原官方原版工具
cd /d "%~dp0"
echo ============================================================
echo   RStudio Desktop 一键还原官方原版 (Restore Original)
echo ============================================================
echo.
python rstudio_zh.py restore %*
echo.
pause
