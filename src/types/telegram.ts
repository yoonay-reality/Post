export interface TelegramConfig {
  apiId: string;
  apiHash: string;
  phoneNumber: string;
  twoFaPassword: string;
  confirmationCode: string;
  sendInterval: number;
  sessionFile?: File;
}

export interface ChannelPair {
  id: string;
  donorId: string;
  recipientIds: string[];
}

export interface Config {
  telegram: TelegramConfig;
  pairs: ChannelPair[];
}

export interface Status {
  isRunning: boolean;
  lastMessage: string;
  lastUpdate: string;
  isConnected: boolean;
}

export type LoginStep = 'phone' | 'session' | 'code' | '2fa' | 'complete' | 'channels';