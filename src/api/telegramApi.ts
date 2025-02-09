import axios from 'axios';
import { Config, Status } from '../types/telegram';

const API_URL = 'http://localhost:8000';

// Configuração do axios com retry e timeout
axios.defaults.timeout = 30000;
axios.defaults.headers.common['Content-Type'] = 'application/json';

const formatPhoneNumber = (phone: string) => {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
};

const handleApiError = (error: any, defaultMessage: string) => {
  console.error('Erro na API:', {
    message: error.message,
    response: error.response?.data,
    status: error.response?.status
  });

  return {
    success: false,
    message: error.response?.data?.message || defaultMessage,
    waitTime: error.response?.data?.waitTime,
    requires2FA: error.response?.data?.requires2FA,
    requiresCode: error.response?.data?.requiresCode
  };
};

export const telegramApi = {
  uploadSession: async (telegramConfig: Config['telegram']) => {
    if (!telegramConfig.sessionFile) {
      return { success: false, message: 'Nenhum arquivo selecionado' };
    }

    const formData = new FormData();
    formData.append('session_file', telegramConfig.sessionFile);

    try {
      console.log('Enviando arquivo de sessão...');
      const response = await axios.post(`${API_URL}/upload-session`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        validateStatus: null
      });
      
      return response.data;
    } catch (error: any) {
      return handleApiError(error, 'Erro ao fazer upload da sessão');
    }
  },

  sendCode: async (telegramConfig: Config['telegram']) => {
    try {
      const formattedConfig = {
        ...telegramConfig,
        phoneNumber: formatPhoneNumber(telegramConfig.phoneNumber)
      };

      console.log('Enviando código para:', formattedConfig.phoneNumber);
      const response = await axios.post(`${API_URL}/send-code`, formattedConfig, {
        validateStatus: null
      });
      
      return response.data;
    } catch (error: any) {
      return handleApiError(error, 'Erro ao enviar código');
    }
  },

  verifyCode: async (telegramConfig: Config['telegram']) => {
    try {
      const formattedConfig = {
        ...telegramConfig,
        phoneNumber: formatPhoneNumber(telegramConfig.phoneNumber)
      };

      console.log('Verificando código:', formattedConfig.confirmationCode);
      const response = await axios.post(`${API_URL}/verify-code`, formattedConfig, {
        validateStatus: null
      });
      
      return response.data;
    } catch (error: any) {
      return handleApiError(error, 'Erro ao verificar código');
    }
  },

  startForwarding: async (config: Config) => {
    try {
      const response = await axios.post(`${API_URL}/start`, config, {
        validateStatus: null
      });
      return response.data;
    } catch (error: any) {
      return handleApiError(error, 'Erro ao iniciar encaminhamento');
    }
  },

  stopForwarding: async () => {
    try {
      const response = await axios.post(`${API_URL}/stop`, {}, {
        validateStatus: null
      });
      return response.data;
    } catch (error: any) {
      return handleApiError(error, 'Erro ao parar encaminhamento');
    }
  },

  getStatus: async (): Promise<Status> => {
    try {
      const response = await axios.get(`${API_URL}/status`, {
        validateStatus: null
      });
      return response.data;
    } catch (error: any) {
      return {
        isRunning: false,
        lastMessage: 'Erro ao buscar status',
        lastUpdate: new Date().toISOString(),
        isConnected: false
      };
    }
  }
};