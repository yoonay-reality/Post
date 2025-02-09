@echo off
echo Iniciando Telegram Forwarder...
echo.

REM Verifica se o Python está instalado
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python nao encontrado! Por favor, instale o Python 3.8 ou superior.
    pause
    exit /b 1
)

REM Verifica se o Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js nao encontrado! Por favor, instale o Node.js 18 ou superior.
    pause
    exit /b 1
)

REM Cria e ativa o ambiente virtual se não existir
if not exist "venv" (
    echo Criando ambiente virtual Python...
    python -m venv venv
)

REM Ativa o ambiente virtual
echo Ativando ambiente virtual...
call venv\Scripts\activate.bat

REM Instala dependências Python se necessário
echo Instalando dependencias Python...
pip install fastapi uvicorn telethon python-multipart pydantic pytz --no-cache-dir

REM Instala dependências Node se necessário
echo Instalando dependencias Node...
call npm install

REM Inicia o servidor backend em uma nova janela
echo Iniciando servidor backend...
start cmd /k "call venv\Scripts\activate.bat && python main.py"

REM Aguarda 5 segundos para o backend inicializar
timeout /t 5 /nobreak >nul

REM Inicia o frontend
echo Iniciando frontend...
start cmd /k "npm run dev"

echo.
echo Telegram Forwarder iniciado!
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul