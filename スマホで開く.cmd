@echo off
python "%~dp0serve.py" --lan
if errorlevel 1 pause
