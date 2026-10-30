@echo off
title Cosmos
cd /d "%~dp0"
echo Starting Cosmos... keep this window open while you use it.
call npm run dev -- --open
pause
