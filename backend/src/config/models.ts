// Lista curada de modelos ofrecidos en el selector del chat (no todo lo que
// expone 9router). multimodal verificado en vivo mandando una imagen real a
// cada uno: solo los gemini la describieron correctamente — claude-sonnet-4-6,
// glm-5.2 y deepseek-flash respondieron "no tengo visión".
export interface ChatModelOption {
  id: string;
  label: string;
  multimodal: boolean;
}

// Confirmado en vivo contra 9router: 200 OK.
export const INKLING_MODEL_ID = 'nvidia/thinkingmachines/inkling';

export const AVAILABLE_MODELS: ChatModelOption[] = [
  { id: INKLING_MODEL_ID, label: 'Inkling', multimodal: true },
  { id: 'oc/deepseek-v4-flash-free', label: 'DeepSeek Flash', multimodal: false },
  { id: 'ag/gemini-3-flash', label: 'Gemini Flash', multimodal: true },
  { id: 'ag/gemini-3.1-pro-low', label: 'Gemini Pro', multimodal: true },
  { id: 'ag/claude-sonnet-4-6', label: 'Claude Sonnet', multimodal: false },
  { id: 'nvidia/z-ai/glm-5.2', label: 'GLM 5.2', multimodal: false },
];

export function isModelMultimodal(modelId: string): boolean {
  const found = AVAILABLE_MODELS.find(m => m.id === modelId);
  return found ? found.multimodal : false;
}

// Label "bonito" del selector (ej. "GLM 5.2") en vez del slug crudo
// (ej. "glm-5.2") — usar solo cuando el usuario ya eligió ese modelo a
// sabiendas desde el selector (ver FIX 3, consolidado post-planes 01-06).
// Nunca usar esto para nombrar un modelo al que Inkling delegó
// automáticamente sin que el usuario lo pidiera.
export function getModelLabel(modelId: string): string {
  const found = AVAILABLE_MODELS.find(m => m.id === modelId);
  return found ? found.label : modelId.split('/').pop() || modelId;
}
