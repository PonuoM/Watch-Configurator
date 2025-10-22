@echo off
echo Starting local web server for Watch Configurator...
echo.
echo Please wait while the server starts...
echo.

REM Try Python 3 first
python -m http.server 8000 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Server started successfully!
    echo.
    echo Open your browser and go to:
    echo http://localhost:8000/run-local.html
    echo.
    echo Press Ctrl+C to stop the server
    goto :end
)

REM If Python 3 fails, try Python
python -m SimpleHTTPServer 8000 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Server started successfully with Python 2!
    echo.
    echo Open your browser and go to:
    echo http://localhost:8000/run-local.html
    echo.
    echo Press Ctrl+C to stop the server
    goto :end
)

REM If both fail, try Node.js if http-server is installed
npx http-server -p 8000 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Server started successfully with Node.js!
    echo.
    echo Open your browser and go to:
    echo http://localhost:8000/run-local.html
    echo.
    echo Press Ctrl+C to stop the server
    goto :end
)

echo.
echo ERROR: Could not start a web server.
echo Please install Python 3 or Node.js and try again.
echo.
echo You can also open run-local.html directly in your browser,
echo but some features may not work due to browser security restrictions.
echo.

:end
pause
