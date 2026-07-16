// Lista curada de modelos ofrecidos en el selector del chat (no todo lo que
// expone 9router). multimodal verificado en vivo mandando una imagen real a
// cada uno: solo los gemini la describieron correctamente — claude-sonnet-4-6,
// glm-5.2 y deepseek-flash respondieron "no tengo visión".
export interface ChatModelOption {
  id: string;
  label: string;
  multimodal: boolean;
}

export const AVAILABLE_MODELS: ChatModelOption[] = [
  { id: 'ag/gemini-3-flash', label: 'Gemini Flash', multimodal: true },
  { id: 'ag/gemini-3.1-pro-low', label: 'Gemini Pro', multimodal: true },
  { id: 'ag/claude-sonnet-4-6', label: 'Claude Sonnet', multimodal: false },
  { id: 'nvidia/z-ai/glm-5.2', label: 'GLM 5.2', multimodal: false },
  { id: 'oc/deepseek-v4-flash-free', label: 'DeepSeek Flash', multimodal: false },
];

export function isModelMultimodal(modelId: string): boolean {
  const found = AVAILABLE_MODELS.find(m => m.id === modelId);
  return found ? found.multimodal : false;
}
