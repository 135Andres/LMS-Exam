import dotenv from 'dotenv';
dotenv.config();

export const nineRouterConfig = {
  apiKey: process.env.NINE_ROUTER_API_KEY || '',
  baseUrl: process.env.NINE_ROUTER_BASE_URL || 'https://api.9router.com/v1',
  timeout: parseInt(process.env.NINE_ROUTER_TIMEOUT_MS || '60000', 10),
  defaultModel: process.env.NINE_ROUTER_DEFAULT_MODEL || 'auto',
  enableFallback: process.env.NINE_ROUTER_ENABLE_FALLBACK !== 'false',
  fallbackModels: (process.env.NINE_ROUTER_FALLBACK_MODELS || '').split(',').filter(Boolean),
  tags: {
    app: 'lms-exam',
    version: process.env.APP_VERSION || 'dev',
  },
};

if (!nineRouterConfig.apiKey && process.env.NODE_ENV === 'production') {
  throw new Error('NINE_ROUTER_API_KEY es requerido en producción');
}