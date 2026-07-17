import dotenv from 'dotenv';
import { INKLING_MODEL_ID } from './models.js';
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

  nineRouter: {
    apiKey: required('NINE_ROUTER_API_KEY'),
    baseUrl: process.env.NINE_ROUTER_BASE_URL || 'http://localhost:20128/v1',
  },

  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY || '',
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  },

  models: {
    generate: process.env.GENERATE_MODEL || 'nvidia/minimaxai/minimax-m3',
    polish: process.env.POLISH_MODEL || 'nvidia/minimaxai/minimax-m3',
    chat: process.env.CHAT_MODEL || INKLING_MODEL_ID,
    // Validador batch de la KB colectiva.
    kbValidator: process.env.KB_VALIDATOR_MODEL || 'oc/deepseek-v4-flash-free',
    // Análisis nocturno de progreso (insights.service.ts).
    insights: process.env.INSIGHTS_MODEL || 'oc/deepseek-v4-flash-free',
  },

  embeddings: {
    apiKey: process.env.NVIDIA_API_KEY_EMBEDDINGS || required('NVIDIA_API_KEY_EMBEDDINGS'),
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

  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',

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

  orchestrator: {
    enabled: process.env.ORCHESTRATOR_ENABLED !== 'false',
    // ponytail: fase 2 del plan (clasificación con LLM para casos ambiguos)
    // no está implementada — este flag queda listo pero inerte hasta que se escriba.
    llmClassificationFallback: process.env.ENABLE_LLM_CLASSIFICATION_FALLBACK === 'true',
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

export const modelRegistry: Record<string, ModelEntry> = {};
