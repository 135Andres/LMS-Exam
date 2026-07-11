import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  nvidia: {
    apiKey: required('NVIDIA_API_KEY'),
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  },

  zenmux: {
    apiKey: process.env.ZENMUX_API_KEY || '',
    baseUrl: process.env.ZENMUX_BASE_URL || 'https://zenmux.ai/api/v1',
  },

  models: {
    generate: process.env.GENERATE_MODEL || 'minimaxai/minimax-m2.7',
    polish: process.env.POLISH_MODEL || 'deepseek-ai/deepseek-v4-flash',
    chat: process.env.CHAT_MODEL || 'deepseek-ai/deepseek-v4-flash',
  },

  embeddings: {
    apiKey: required('NVIDIA_API_KEY_EMBEDDINGS'),
    model: process.env.NVIDIA_EMBEDDINGS_MODEL || 'nvidia/nv-embed-v1',
    dimensions: parseInt(process.env.NVIDIA_EMBEDDINGS_DIM || '4096', 10),
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    embedAssistantResponses: process.env.EMBED_ASSISTANT_RESPONSES !== 'false',
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  db: {
    path: process.env.DB_PATH || './data/database.sqlite',
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '5', 10),
    generateMax: parseInt(process.env.RATE_LIMIT_GENERATE_MAX || '3', 10),
    generateWindowHours: parseInt(process.env.RATE_LIMIT_GENERATE_WINDOW_HOURS || '1', 10),
    otpMax: parseInt(process.env.RATE_LIMIT_OTP_MAX || '3', 10),
    otpWindowMs: parseInt(process.env.RATE_LIMIT_OTP_WINDOW_MS || '3600000', 10),
    otpVerifyMax: parseInt(process.env.RATE_LIMIT_OTP_VERIFY_MAX || '5', 10),
    otpVerifyWindowMs: parseInt(process.env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS || '60000', 10),
  },
};

export interface ModelEntry {
  apiKey: string;
  model: string;
  baseUrl: string;
  label: string;
  multimodal?: boolean;
  contextLength?: number;
}

export const modelRegistry: Record<string, ModelEntry> = {
  'nemotron-3-nano': {
    apiKey: process.env.NVIDIA_API_KEY_NEMOTRON_NANO || config.nvidia.apiKey,
    model: process.env.NVIDIA_MODEL_NEMOTRON_NANO || '',
    baseUrl: process.env.NVIDIA_BASE_URL_NEMOTRON_NANO || config.nvidia.baseUrl,
    label: 'Nemotron 3 Nano (multimodal)',
    multimodal: true,
    contextLength: 128000,
  },
  'nemotron-3-super': {
    apiKey: process.env.NVIDIA_API_KEY_NEMOTRON_SUPER || config.nvidia.apiKey,
    model: process.env.NVIDIA_MODEL_NEMOTRON_SUPER || '',
    baseUrl: process.env.NVIDIA_BASE_URL_NEMOTRON_SUPER || config.nvidia.baseUrl,
    label: 'Nemotron 3 Super',
    contextLength: 128000,
  },
  'deepseek-v4-flash': {
    apiKey: process.env.NVIDIA_API_KEY_DEEPSEEK || config.nvidia.apiKey,
    model: process.env.NVIDIA_MODEL_DEEPSEEK || 'deepseek-ai/deepseek-v4-flash',
    baseUrl: process.env.NVIDIA_BASE_URL_DEEPSEEK || config.nvidia.baseUrl,
    label: 'DeepSeek V4 Flash',
    contextLength: 128000,
  },
  'claude-fable-5-free': {
    apiKey: config.zenmux.apiKey,
    model: process.env.ZENMUX_MODEL_CLAUDE_FABLE_5 || 'anthropic/claude-fable-5-free',
    baseUrl: config.zenmux.baseUrl,
    label: 'Claude Fable 5 (free)',
    contextLength: 128000,
  },
  'claude-sonnet-5-free': {
    apiKey: config.zenmux.apiKey,
    model: process.env.ZENMUX_MODEL_CLAUDE_SONNET_5 || 'anthropic/claude-sonnet-5-free',
    baseUrl: config.zenmux.baseUrl,
    label: 'Claude Sonnet 5 (free)',
    contextLength: 128000,
  },
  'step-3.7-flash-free': {
    apiKey: config.zenmux.apiKey,
    model: process.env.ZENMUX_MODEL_STEP_3_7_FLASH || 'stepfun/step-3.7-flash-free',
    baseUrl: config.zenmux.baseUrl,
    label: 'Step 3.7 Flash (free)',
    contextLength: 128000,
  },
  'glm-4.7-flash-free': {
    apiKey: config.zenmux.apiKey,
    model: process.env.ZENMUX_MODEL_GLM_4_7_FLASH || 'z-ai/glm-4.7-flash-free',
    baseUrl: config.zenmux.baseUrl,
    label: 'GLM 4.7 Flash (free)',
    contextLength: 128000,
  },
};
