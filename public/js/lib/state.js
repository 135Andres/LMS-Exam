export const state = {
  selectedModelId: '',
  availableModels: [],
  pendingAttachments: [],
  sessionId: sessionStorage.getItem('chatSessionId') || '',
  historyLoaded: null,
  linkModeActive: false,
  activeLinks: [],
};

export const sessionState = {
  email: '',
  name: '',
  role: '',
  createdAt: '',
  examsGenerated: 0,
  totalApiCost: 0,
  userMessages: 0,
  assistantMessages: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  provider: '',
  model: '',
  contextLength: 0,
  chatCreated: '',
  lastActivity: '',
};
