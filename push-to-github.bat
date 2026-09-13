@echo off
echo ========================================================
echo   Pushing JANRAKSHAK to GitHub Repository
echo   https://github.com/namankumarsingh321-sketch/JANRAKSHAK
echo ========================================================
cd /d %~dp0

git init
git add .
git commit -m "JANRAKSHAK: Highway Landslide Early Warning System - Complete Release"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/namankumarsingh321-sketch/JANRAKSHAK.git
git push -u origin main

echo ========================================================
echo   Done! Check your repository on GitHub.
echo ========================================================
pause
