@echo off
REM  Aurora - ponte per il mouse
REM  Doppio clic su questo file. Non serve installare nulla.
REM
REM  Se Windows blocca l'esecuzione, la riga qui sotto la consente per
REM  QUESTO solo avvio, senza cambiare nulla nel sistema.
title Aurora - ponte per il mouse
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0aurora-mouse.ps1"
if errorlevel 1 (
  echo.
  echo  Qualcosa non ha funzionato. Premi un tasto per chiudere.
  pause >nul
)
