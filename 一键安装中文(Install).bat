@echo off
chcp 65001 >nul
title RStudio Desktop 简体中文汉化一键安装工具
cd /d "%~dp0"
echo ============================================================
echo   RStudio Desktop 简体中文 (zh_CN) 选项及全量汉化一键安装
echo ============================================================
echo.
python rstudio_zh.py install %*
echo.
pause
