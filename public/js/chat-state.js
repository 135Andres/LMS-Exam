// Estado mutable compartido entre los módulos chat-*.js. Los bindings de
// import de ES modules son de solo lectura — un módulo no puede reasignar
// una variable "let" exportada por otro módulo. Como sessionId, selectedModelId,
// etc. se reasignan desde varias features (streaming, sesiones, hero, input),
// viven como propiedades de un objeto compartido en vez de "let" sueltos —
// mutar una propiedad sí es visible entre módulos porque comparten la misma
// referencia de objeto (mismo patrón que ya usaba sessionState antes de este split).
export const state = {
  sessionId: sessionStorage.getItem('chatSessionId') || '',
  selectedModelId: '',
  availableModels: [],
  pendingAttachments: [],
  activeLinks: [],
  currentMode: 'chat',
  sessionState: {
    email: '',
    name: '',
    role: '',
    createdAt: '',
    examsGenerated: 0,
    totalApiCost: 0,
    avatarData: null,
    userMessages: 0,
    assistantMessages: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    provider: 'NVIDIA',
    model: '',
    contextLength: 128000,
    chatCreated: '',
    lastActivity: '',
  },
};
