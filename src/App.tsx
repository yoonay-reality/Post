import React, { useState, useEffect } from 'react';
import { Play, Square, RefreshCw, Upload, ArrowLeft, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Config, Status, LoginStep } from './types/telegram';
import { telegramApi } from './api/telegramApi';

function App() {
  const [loginStep, setLoginStep] = useState<LoginStep>('session');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [waitTime, setWaitTime] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({
    isRunning: false,
    lastMessage: '',
    lastUpdate: '',
    isConnected: false
  });

  const [config, setConfig] = useState<Config>({
    telegram: {
      apiId: '',
      apiHash: '',
      phoneNumber: '',
      twoFaPassword: '',
      confirmationCode: '',
      sendInterval: 30
    },
    pairs: []
  });

  useEffect(() => {
    const checkStatus = async () => {
      const currentStatus = await telegramApi.getStatus();
      setStatus(currentStatus);
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (waitTime && waitTime > 0) {
      timer = setInterval(() => {
        setWaitTime(prev => {
          if (prev && prev > 0) {
            return prev - 1;
          }
          return null;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [waitTime]);

  const handleConfigChange = (field: keyof Config['telegram'], value: string) => {
    setError('');
    setSuccess('');
    setConfig(prev => ({
      ...prev,
      telegram: {
        ...prev.telegram,
        [field]: value
      }
    }));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setError('');
      setSuccess('');
      setConfig(prev => ({
        ...prev,
        telegram: {
          ...prev.telegram,
          sessionFile: file
        }
      }));
    }
  };

  const handleBack = () => {
    setError('');
    setSuccess('');
    setWaitTime(null);
    
    switch (loginStep) {
      case 'code':
        setLoginStep('2fa');
        break;
      case '2fa':
        setLoginStep('phone');
        break;
      case 'phone':
        setLoginStep('session');
        break;
      case 'channels':
        setLoginStep('complete');
        break;
      default:
        break;
    }
  };

  const validatePhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  };

  const handleStart = async () => {
    try {
      setIsLoading(true);
      setError('');
      setSuccess('');
      setWaitTime(null);

      if (loginStep === 'session') {
        if (!config.telegram.sessionFile) {
          setError('Selecione um arquivo de sessão');
          return;
        }

        const response = await telegramApi.uploadSession(config.telegram);
        if (response.success) {
          setLoginStep('complete');
          setSuccess('Sessão carregada com sucesso!');
        } else {
          setError(response.message);
          if (response.message.includes('expirado')) {
            setTimeout(() => setLoginStep('phone'), 2000);
          }
        }
      } else if (loginStep === 'phone') {
        if (!config.telegram.apiId || !config.telegram.apiHash || !config.telegram.phoneNumber) {
          setError('Por favor, preencha todos os campos');
          return;
        }

        const formattedPhone = validatePhoneNumber(config.telegram.phoneNumber);
        setConfig(prev => ({
          ...prev,
          telegram: {
            ...prev.telegram,
            phoneNumber: formattedPhone
          }
        }));

        setLoginStep('2fa');
        setSuccess('Se você tem verificação em duas etapas ativada, insira sua senha 2FA');
      } else if (loginStep === '2fa') {
        const response = await telegramApi.sendCode(config.telegram);
        if (response.success) {
          setLoginStep('code');
          setSuccess('Código enviado! Verifique seu Telegram');
        } else {
          setError(response.message);
          if (response.waitTime) {
            setWaitTime(response.waitTime);
          }
        }
      } else if (loginStep === 'code') {
        if (!config.telegram.confirmationCode) {
          setError('Por favor, insira o código de verificação');
          return;
        }

        const response = await telegramApi.verifyCode(config.telegram);
        if (response.success) {
          setLoginStep('complete');
          setSuccess('Login realizado com sucesso!');
        } else {
          setError(response.message);
          
          if (response.requires2FA) {
            setLoginStep('2fa');
            setSuccess('Por favor, insira sua senha 2FA');
          } else if (response.requiresCode) {
            setSuccess('');
          }
        }
      } else if (loginStep === 'complete') {
        setLoginStep('channels');
      } else if (loginStep === 'channels') {
        if (config.pairs.length === 0) {
          setError('Adicione pelo menos um par de canais');
          return;
        }

        for (const pair of config.pairs) {
          if (!pair.donorId || pair.recipientIds.some(id => !id)) {
            setError('Preencha todos os IDs dos canais');
            return;
          }
        }

        const response = await telegramApi.startForwarding(config);
        if (response.success) {
          setSuccess('Encaminhamento iniciado com sucesso!');
        } else {
          setError(response.message);
        }
      }
    } catch (error: any) {
      console.error('Erro:', error);
      setError(error.response?.data?.message || error.message || 'Erro desconhecido');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    try {
      setIsLoading(true);
      setError('');
      setSuccess('');

      const response = await telegramApi.stopForwarding();
      if (response.success) {
        setSuccess('Encaminhamento parado com sucesso!');
      } else {
        setError(response.message);
      }
    } catch (error: any) {
      console.error('Erro ao parar:', error);
      setError(error.response?.data?.message || error.message || 'Erro ao parar encaminhamento');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddPair = () => {
    setConfig(prev => ({
      ...prev,
      pairs: [
        ...prev.pairs,
        {
          id: crypto.randomUUID(),
          donorId: '',
          recipientIds: ['']
        }
      ]
    }));
  };

  const handleRemovePair = (id: string) => {
    setConfig(prev => ({
      ...prev,
      pairs: prev.pairs.filter(pair => pair.id !== id)
    }));
  };

  const handlePairChange = (id: string, field: 'donorId' | 'recipientIds', value: string | string[]) => {
    setConfig(prev => ({
      ...prev,
      pairs: prev.pairs.map(pair => {
        if (pair.id === id) {
          return {
            ...pair,
            [field]: value
          };
        }
        return pair;
      })
    }));
  };

  const handleAddRecipient = (pairId: string) => {
    setConfig(prev => ({
      ...prev,
      pairs: prev.pairs.map(pair => {
        if (pair.id === pairId) {
          return {
            ...pair,
            recipientIds: [...pair.recipientIds, '']
          };
        }
        return pair;
      })
    }));
  };

  const handleRemoveRecipient = (pairId: string, index: number) => {
    setConfig(prev => ({
      ...prev,
      pairs: prev.pairs.map(pair => {
        if (pair.id === pairId) {
          const newRecipients = [...pair.recipientIds];
          newRecipients.splice(index, 1);
          return {
            ...pair,
            recipientIds: newRecipients
          };
        }
        return pair;
      })
    }));
  };

  const handleUpdateRecipient = (pairId: string, index: number, value: string) => {
    setConfig(prev => ({
      ...prev,
      pairs: prev.pairs.map(pair => {
        if (pair.id === pairId) {
          const newRecipients = [...pair.recipientIds];
          newRecipients[index] = value;
          return {
            ...pair,
            recipientIds: newRecipients
          };
        }
        return pair;
      })
    }));
  };

  const renderLoginFields = () => {
    switch (loginStep) {
      case 'session':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-center w-full mt-4">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 mb-3 text-gray-400" />
                  <p className="mb-2 text-sm text-gray-500">
                    <span className="font-semibold">Clique para fazer upload</span> ou arraste o arquivo de sessão
                  </p>
                  <p className="text-xs text-gray-500">Arquivo telegram_session</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".session"
                />
              </label>
            </div>
            <div className="text-center">
              <button
                onClick={() => setLoginStep('phone')}
                className="text-blue-500 hover:text-blue-700 transition-colors"
              >
                Ou faça login com número de telefone
              </button>
            </div>
          </div>
        );
      case 'phone':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API ID</label>
              <input
                type="text"
                placeholder="12345678"
                value={config.telegram.apiId}
                onChange={(e) => handleConfigChange('apiId', e.target.value)}
                className="p-2 border rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Hash</label>
              <input
                type="text"
                placeholder="0123456789abcdef0123456789abcdef"
                value={config.telegram.apiHash}
                onChange={(e) => handleConfigChange('apiHash', e.target.value)}
                className="p-2 border rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número de Telefone</label>
              <input
                type="tel"
                placeholder="+5511999999999"
                value={config.telegram.phoneNumber}
                onChange={(e) => handleConfigChange('phoneNumber', e.target.value)}
                className="p-2 border rounded w-full"
              />
            </div>
            <div className="flex justify-between items-center mt-4">
              <button
                onClick={handleBack}
                className="text-blue-500 hover:text-blue-700 transition-colors flex items-center"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Voltar
              </button>
            </div>
          </div>
        );
      case '2fa':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Senha 2FA (opcional)</label>
              <input
                type="password"
                placeholder="Sua senha 2FA"
                value={config.telegram.twoFaPassword}
                onChange={(e) => handleConfigChange('twoFaPassword', e.target.value)}
                className="p-2 border rounded w-full"
                autoComplete="current-password"
              />
            </div>
            <div className="text-center text-sm text-gray-600">
              <p>Se você tem verificação em duas etapas ativada, insira sua senha 2FA</p>
              <p className="mt-2">Se não tiver, pode deixar em branco</p>
            </div>
            <div className="flex justify-between items-center mt-4">
              <button
                onClick={handleBack}
                className="text-blue-500 hover:text-blue-700 transition-colors flex items-center"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Voltar
              </button>
            </div>
          </div>
        );
      case 'code':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código de Verificação</label>
              <input
                type="text"
                placeholder="12345"
                value={config.telegram.confirmationCode}
                onChange={(e) => handleConfigChange('confirmationCode', e.target.value)}
                className="p-2 border rounded w-full"
              />
            </div>
            <div className="text-center text-sm text-gray-600">
              <p>Um código foi enviado para seu Telegram</p>
              {waitTime !== null && waitTime > 0 && (
                <p className="mt-2 text-orange-600">
                  Aguarde {waitTime} segundos para tentar novamente
                </p>
              )}
            </div>
            <div className="flex justify-between items-center mt-4">
              <button
                onClick={handleBack}
                className="text-blue-500 hover:text-blue-700 transition-colors flex items-center"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Voltar
              </button>
            </div>
          </div>
        );
      case 'channels':
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold text-gray-900">Configurar Canais</h3>
              <p className="text-sm text-gray-600">
                Configure os canais de origem e destino para o encaminhamento de mensagens
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Intervalo entre envios
              </label>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-600 mb-1">Minutos</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={Math.floor(config.telegram.sendInterval / 60)}
                    onChange={(e) => {
                      const minutes = parseInt(e.target.value) || 0;
                      const seconds = config.telegram.sendInterval % 60;
                      handleConfigChange('sendInterval', (minutes * 60 + seconds).toString());
                    }}
                    className="p-2 border rounded w-full"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-600 mb-1">Segundos</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={config.telegram.sendInterval % 60}
                    onChange={(e) => {
                      const seconds = parseInt(e.target.value) || 0;
                      const minutes = Math.floor(config.telegram.sendInterval / 60);
                      handleConfigChange('sendInterval', (minutes * 60 + seconds).toString());
                    }}
                    className="p-2 border rounded w-full"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Tempo de espera entre o envio de cada grupo de mensagens
              </p>
            </div>

            {config.pairs.map((pair) => (
              <div key={pair.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-sm font-medium text-gray-700">Par de Canais</h4>
                  <button
                    onClick={() => handleRemovePair(pair.id)}
                    className="text-red-500 hover:text-red-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      ID do Canal de Origem
                    </label>
                    <input
                      type="text"
                      placeholder="-100123456789"
                      value={pair.donorId}
                      onChange={(e) => handlePairChange(pair.id, 'donorId', e.target.value)}
                      className="p-2 border rounded w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        IDs dos Canais de Destino
                      </label>
                      <button
                        onClick={() => handleAddRecipient(pair.id)}
                        className="text-blue-500 hover:text-blue-700 transition-colors flex items-center text-sm"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Adicionar Destino
                      </button>
                    </div>

                    {pair.recipientIds.map((recipientId, index) => (
                      <div key={index} className="flex gap-2 mb-2">
                        <input
                          type="text"
                          placeholder="-100123456789"
                          value={recipientId}
                          onChange={(e) => handleUpdateRecipient(pair.id, index, e.target.value)}
                          className="p-2 border rounded flex-1"
                        />
                        {pair.recipientIds.length > 1 && (
                          <button
                            onClick={() => handleRemoveRecipient(pair.id, index)}
                            className="text-red-500 hover:text-red-700 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={handleAddPair}
              className="w-full py-2 px-4 border border-blue-500 text-blue-500 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Adicionar Par de Canais
            </button>

            <div className="flex justify-between items-center mt-4">
              <button
                onClick={handleBack}
                className="text-blue-500 hover:text-blue-700 transition-colors flex items-center"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Voltar
              </button>
            </div>
          </div>
        );
      case 'complete':
        return (
          <div className="text-center space-y-4">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
            <h3 className="text-xl font-semibold text-gray-900">Login Realizado com Sucesso!</h3>
            <p className="text-gray-600">
              Você está conectado ao Telegram. Clique em continuar para configurar os canais.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-600 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div className="divide-y divide-gray-200">
              <div className="py-8 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <h2 className="text-2xl font-bold mb-8 text-center text-gray-900">
                  Telegram Forwarder
                </h2>
                
                {error && (
                  <div className="flex items-center p-4 mb-4 text-red-800 rounded-lg bg-red-50">
                    <AlertCircle className="w-5 h-5 mr-2" />
                    <span>{error}</span>
                  </div>
                )}

                {success && (
                  <div className="flex items-center p-4 mb-4 text-green-800 rounded-lg bg-green-50">
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    <span>{success}</span>
                  </div>
                )}

                {renderLoginFields()}

                <div className="mt-8 flex justify-center gap-4">
                  {loginStep === 'channels' && status.isRunning ? (
                    <button
                      onClick={handleStop}
                      disabled={isLoading}
                      className={`
                        px-6 py-2 rounded-lg text-white font-medium flex items-center gap-2
                        ${isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 transition-colors'}
                      `}
                    >
                      {isLoading ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Square className="w-5 h-5" />
                          Parar
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={handleStart}
                      disabled={isLoading || (waitTime !== null && waitTime > 0)}
                      className={`
                        px-6 py-2 rounded-lg text-white font-medium flex items-center gap-2
                        ${(isLoading || (waitTime !== null && waitTime > 0))
                          ? 'bg-gray-400 cursor-not-allowed' 
                          : 'bg-blue-500 hover:bg-blue-600 transition-colors'}
                      `}
                    >
                      {isLoading ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          {loginStep === 'channels' ? (
                            <>
                              <Play className="w-5 h-5" />
                              Iniciar
                            </>
                          ) : (
                            'Continuar'
                          )}
                        </>
                      )}
                    </button>
                  )}
                </div>

                {status.lastMessage && (
                  <div className="mt-4 text-sm text-gray-600 text-center">
                    <p>Última atualização: {new Date(status.lastUpdate).toLocaleString()}</p>
                    <p>{status.lastMessage}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;