from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import List, Optional, Dict
import asyncio
import uvicorn
from datetime import datetime
import pytz
from telethon import TelegramClient
from telethon.errors import (
    SessionPasswordNeededError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    FloodWaitError,
    SessionExpiredError,
    PhoneNumberInvalidError,
    ApiIdInvalidError,
    ChatWriteForbiddenError,
    ChannelPrivateError,
    AuthKeyUnregisteredError
)
from asyncio import sleep
import random
import shutil
import os
import logging
import json
from pathlib import Path

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('telegram_forwarder.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Modelos Pydantic
class TelegramConfig(BaseModel):
    apiId: str = ""
    apiHash: str = ""
    phoneNumber: str = ""
    twoFaPassword: str = ""
    confirmationCode: str = ""
    sendInterval: int = 30

    @field_validator('phoneNumber')
    def validate_phone(cls, v):
        if v:
            v = v.replace(' ', '').replace('-', '')
            if not v.startswith('+'):
                v = '+' + v
        return v

    @field_validator('apiId')
    def validate_api_id(cls, v):
        if v and not v.isdigit():
            raise ValueError('API ID deve conter apenas números')
        return v

class ChannelPair(BaseModel):
    id: str
    donorId: str
    recipientIds: List[str]

class Config(BaseModel):
    telegram: TelegramConfig
    pairs: List[ChannelPair]

class AuthResponse(BaseModel):
    success: bool
    message: str
    requires2FA: Optional[bool] = None
    requiresCode: Optional[bool] = None
    waitTime: Optional[int] = None

# Estado global
class TelegramState:
    def __init__(self):
        self.client = None
        self.forwarder_task = None
        self.is_running = False
        self.last_message = ""
        self.last_update = ""
        self.phone_code_hash = None
        self.session_info = {
            "api_id": None,
            "api_hash": None,
            "phone": None,
            "two_fa_password": None
        }
        self.retry_count = 0
        self.max_retries = 3
        self.send_interval = 30
        self.pairs = []
        self.error_counts = {}
        self.last_error_time = {}

state = TelegramState()

# Inicialização do FastAPI
app = FastAPI()

# Configuração CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def update_status(message: str):
    """Atualiza o status do sistema"""
    state.last_message = message
    state.last_update = datetime.now(pytz.UTC).isoformat()
    logger.info(message)

async def cleanup_session():
    """Limpa dados sensíveis e arquivos temporários"""
    if os.path.exists('telegram_session.session'):
        try:
            os.remove('telegram_session.session')
        except Exception as e:
            logger.error(f"Erro ao limpar sessão: {e}")
    
    state.session_info = {
        "api_id": None,
        "api_hash": None,
        "phone": None,
        "two_fa_password": None
    }
    state.phone_code_hash = None

async def disconnect_client():
    """Desconecta o cliente com limpeza adequada"""
    if state.client:
        try:
            await state.client.disconnect()
        except Exception as e:
            logger.error(f"Erro ao desconectar cliente: {e}")
        finally:
            state.client = None

async def create_client(force_new: bool = False):
    """Cria ou reconecta o cliente com retry automático"""
    if force_new:
        await disconnect_client()
    
    try:
        if not state.client:
            if not state.session_info["api_id"] or not state.session_info["api_hash"]:
                if os.path.exists('telegram_session.session'):
                    try:
                        state.client = TelegramClient('telegram_session', 1, "temp")
                        await state.client.connect()
                        if await state.client.is_user_authorized():
                            return True
                    except:
                        await disconnect_client()
                        await cleanup_session()
                return False
            
            state.client = TelegramClient(
                'telegram_session',
                state.session_info["api_id"],
                state.session_info["api_hash"]
            )
        
        if not state.client.is_connected():
            await state.client.connect()
        
        return True
    except Exception as e:
        logger.error(f"Erro ao criar cliente: {str(e)}")
        await disconnect_client()
        await cleanup_session()
        return False

async def ensure_client_connected():
    """Verifica e mantém a conexão do cliente"""
    try:
        if not await create_client():
            return False
        
        is_connected = await state.client.is_user_authorized()
        logger.info(f"Status da conexão: {'Conectado' if is_connected else 'Desconectado'}")
        return is_connected
    except SessionExpiredError:
        logger.error("Sessão expirada")
        await disconnect_client()
        await cleanup_session()
        return False
    except Exception as e:
        logger.error(f"Erro ao verificar conexão: {str(e)}")
        return False

async def get_all_messages(donor_id: int, offset_id: int = 0):
    """Obtém todas as mensagens do canal"""
    messages = []
    try:
        # Obtém todas as mensagens sem limite de data
        async for message in state.client.iter_messages(donor_id, reverse=True, offset_id=offset_id):
            messages.append(message)
    except Exception as e:
        logger.error(f"Erro ao obter mensagens do canal {donor_id}: {e}")
    return messages

async def forward_messages():
    """Encaminha mensagens entre canais em ciclo contínuo"""
    while state.is_running:
        try:
            for pair in state.pairs:
                if not state.is_running:
                    return

                try:
                    donor_id = int(pair.donorId)
                    recipient_ids = [int(rid) for rid in pair.recipientIds]
                    offset_id = 0
                    
                    while state.is_running:
                        # Obtém mensagens a partir do último offset
                        messages = await get_all_messages(donor_id, offset_id)
                        
                        if not messages:
                            logger.info(f"Nenhuma mensagem encontrada no canal {donor_id}")
                            break
                        
                        # Agrupa mensagens por grouped_id
                        message_groups = {}
                        for msg in messages:
                            group_key = msg.grouped_id if msg.grouped_id else msg.id
                            if group_key not in message_groups:
                                message_groups[group_key] = []
                            message_groups[group_key].append(msg)
                            offset_id = max(offset_id, msg.id)
                        
                        # Converte as chaves em lista e embaralha
                        group_ids = list(message_groups.keys())
                        random.shuffle(group_ids)
                        
                        # Processa cada grupo de mensagens em ordem aleatória
                        for group_id in group_ids:
                            if not state.is_running:
                                return
                                
                            grouped_messages = message_groups[group_id]
                            # Ordena mensagens dentro do grupo pela ordem original
                            grouped_messages.sort(key=lambda x: x.id)
                            
                            success = True
                            for recipient_id in recipient_ids:
                                for attempt in range(5):
                                    try:
                                        await state.client.forward_messages(
                                            recipient_id,
                                            grouped_messages,
                                            from_peer=donor_id
                                        )
                                        # Reseta contadores de erro em caso de sucesso
                                        state.error_counts[recipient_id] = 0
                                        if recipient_id in state.last_error_time:
                                            del state.last_error_time[recipient_id]
                                        break
                                    except FloodWaitError as e:
                                        wait_time = int(str(e).split('flood wait of ')[1].split(' seconds')[0])
                                        logger.warning(f"FloodWaitError para {recipient_id}, aguardando {wait_time} segundos")
                                        await sleep(wait_time)
                                        continue
                                    except (ChatWriteForbiddenError, ChannelPrivateError) as e:
                                        logger.error(f"Erro de permissão para {recipient_id}: {e}")
                                        success = False
                                        break
                                    except Exception as e:
                                        logger.error(f"Tentativa {attempt + 1} falhou para {recipient_id}: {e}")
                                        if attempt == 4:
                                            success = False
                                            state.error_counts[recipient_id] = state.error_counts.get(recipient_id, 0) + 1
                                            state.last_error_time[recipient_id] = datetime.now(pytz.UTC)
                                        await sleep(2)
                            
                            if success:
                                update_status(f"Grupo de {len(grouped_messages)} mensagens encaminhado com sucesso")
                                # Aguarda o intervalo configurado entre grupos
                                await sleep(state.send_interval)
                    
                    update_status("Ciclo completo. Iniciando novo ciclo de envio...")
                    
                except Exception as e:
                    logger.error(f"Erro ao processar par de canais: {str(e)}")
                    continue
                
        except Exception as e:
            logger.error(f"Erro no loop de encaminhamento: {str(e)}")
            if isinstance(e, (SessionExpiredError, AuthKeyUnregisteredError)):
                state.is_running = False
                update_status("Sessão expirada. Por favor, faça login novamente.")
                break
            await sleep(5)
        
        # Pequeno intervalo antes de iniciar novo ciclo
        await sleep(1)

@app.post("/upload-session")
async def upload_session(session_file: UploadFile = File(...)):
    try:
        logger.info("Iniciando upload da sessão...")
        await disconnect_client()
        
        # Limpa sessão anterior
        await cleanup_session()
        
        with open("telegram_session.session", "wb") as buffer:
            shutil.copyfileobj(session_file.file, buffer)
        
        if await create_client(force_new=True):
            if await state.client.is_user_authorized():
                update_status("Sessão carregada com sucesso")
                return AuthResponse(
                    success=True,
                    message="Sessão válida e autenticada"
                )
        
        await cleanup_session()
        update_status("Sessão inválida")
        return AuthResponse(
            success=False,
            message="Arquivo de sessão inválido ou expirado"
        )
            
    except Exception as e:
        logger.error(f"Erro ao carregar sessão: {str(e)}")
        await cleanup_session()
        return AuthResponse(
            success=False,
            message="Erro ao processar arquivo de sessão"
        )

@app.post("/send-code")
async def send_code(config: TelegramConfig):
    try:
        logger.info(f"Enviando código para {config.phoneNumber}")
        
        # Valida API ID e Hash
        try:
            state.session_info["api_id"] = int(config.apiId)
            state.session_info["api_hash"] = config.apiHash
            state.session_info["phone"] = config.phoneNumber
            state.session_info["two_fa_password"] = config.twoFaPassword
        except ValueError:
            return AuthResponse(
                success=False,
                message="API ID inválido"
            )
        
        await create_client(force_new=True)
        
        try:
            send_code_result = await state.client.send_code_request(config.phoneNumber)
            state.phone_code_hash = send_code_result.phone_code_hash
            state.retry_count = 0
            
            update_status("Código de verificação enviado")
            return AuthResponse(
                success=True,
                message="Código enviado com sucesso",
                requiresCode=True
            )
        except FloodWaitError as e:
            wait_time = int(str(e).split('flood wait of ')[1].split(' seconds')[0])
            return AuthResponse(
                success=False,
                message=f"Muitas tentativas. Aguarde {wait_time} segundos.",
                waitTime=wait_time
            )
        except PhoneNumberInvalidError:
            return AuthResponse(
                success=False,
                message="Número de telefone inválido"
            )
        except ApiIdInvalidError:
            return AuthResponse(
                success=False,
                message="API ID ou Hash inválidos"
            )
            
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Erro ao enviar código: {error_msg}")
        return AuthResponse(
            success=False,
            message="Erro ao enviar código de verificação"
        )

@app.post("/verify-code")
async def verify_code(config: TelegramConfig):
    try:
        logger.info("Verificando código...")
        
        if not await create_client():
            return AuthResponse(
                success=False,
                message="Erro de conexão. Tente novamente."
            )
        
        try:
            await state.client.sign_in(
                phone=state.session_info["phone"],
                code=config.confirmationCode,
                phone_code_hash=state.phone_code_hash
            )
            
            update_status("Login realizado com sucesso")
            return AuthResponse(
                success=True,
                message="Login realizado com sucesso"
            )
            
        except SessionPasswordNeededError:
            if state.session_info["two_fa_password"]:
                try:
                    await state.client.sign_in(password=state.session_info["two_fa_password"])
                    update_status("Login com 2FA realizado com sucesso")
                    return AuthResponse(
                        success=True,
                        message="Login realizado com sucesso"
                    )
                except Exception as pwd_error:
                    state.retry_count += 1
                    if state.retry_count >= state.max_retries:
                        await cleanup_session()
                    return AuthResponse(
                        success=False,
                        message="Senha 2FA incorreta",
                        requires2FA=True
                    )
            else:
                return AuthResponse(
                    success=False,
                    message="Autenticação 2FA necessária",
                    requires2FA=True
                )
            
        except PhoneCodeInvalidError:
            state.retry_count += 1
            if state.retry_count >= state.max_retries:
                await cleanup_session()
            return AuthResponse(
                success=False,
                message="Código inválido",
                requiresCode=True
            )
        except PhoneCodeExpiredError:
            await cleanup_session()
            return AuthResponse(
                success=False,
                message="Código expirado. Solicite um novo código.",
                requiresCode=True
            )
            
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Erro ao verificar código: {error_msg}")
        if state.retry_count >= state.max_retries:
            await cleanup_session()
        return AuthResponse(
            success=False,
            message="Erro ao verificar código"
        )

@app.post("/start")
async def start_forwarding(config: Config):
    """Inicia o processo de encaminhamento"""
    try:
        if not await ensure_client_connected():
            return {"success": False, "message": "Cliente não está conectado"}
        
        if state.is_running:
            return {"success": False, "message": "Encaminhamento já está em execução"}
        
        # Atualiza configurações
        state.pairs = config.pairs
        state.send_interval = config.telegram.sendInterval
        state.error_counts.clear()
        state.last_error_time.clear()
        
        # Inicia o processo de encaminhamento
        state.is_running = True
        state.forwarder_task = asyncio.create_task(forward_messages())
        
        update_status("Encaminhamento iniciado")
        return {"success": True, "message": "Encaminhamento iniciado com sucesso"}
        
    except Exception as e:
        logger.error(f"Erro ao iniciar encaminhamento: {str(e)}")
        return {"success": False, "message": str(e)}

@app.post("/stop")
async def stop_forwarding():
    """Para o processo de encaminhamento"""
    try:
        if not state.is_running:
            return {"success": False, "message": "Encaminhamento não está em execução"}
        
        state.is_running = False
        if state.forwarder_task:
            state.forwarder_task.cancel()
            try:
                await state.forwarder_task
            except asyncio.CancelledError:
                pass
            state.forwarder_task = None
        
        update_status("Encaminhamento parado")
        return {"success": True, "message": "Encaminhamento parado com sucesso"}
        
    except Exception as e:
        logger.error(f"Erro ao parar encaminhamento: {str(e)}")
        return {"success": False, "message": str(e)}

@app.get("/status")
async def get_status():
    """Retorna o status atual do sistema"""
    try:
        is_connected = await ensure_client_connected()
        
        return {
            "isRunning": state.is_running,
            "lastMessage": state.last_message,
            "lastUpdate": state.last_update,
            "isConnected": is_connected,
            "errorCounts": state.error_counts
        }
    except Exception as e:
        logger.error(f"Erro ao obter status: {str(e)}")
        return {
            "isRunning": False,
            "lastMessage": f"Erro: {str(e)}",
            "lastUpdate": datetime.now(pytz.UTC).isoformat(),
            "isConnected": False,
            "errorCounts": {}
        }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)