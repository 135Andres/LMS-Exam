export interface UserRow {
  id: string;
  email: string;
  username: string | null;
  password_hash: string | null;
  role: 'admin' | 'user';
  created_at: string;
  exams_generated: number;
  total_api_cost: number;
  // Fase 0 — flag de setup del perfil adaptativo (1 = ya hizo entrevista, 0 = pendiente)
  has_completed_setup: number;
  // Onboarding — preferencias del perfil adaptativo
  onboarding_exam: string;
  onboarding_archetype: string;
  onboarding_feedback_style: string;
  onboarding_strictness: string;
  onboarding_status: string;
  // Modal de Settings
  avatar_data: string | null;
  language: string;
  theme: string;
  font: string;
  reduced_motion: number;
  notify_on_response: number;
  cross_chat_enabled: number;
}

export interface ExamRow {
  id: string;
  user_id: string;
  name: string;
  num_questions: number;
  status: 'pending' | 'generating' | 'ready' | 'completed';
  score: number | null;
  data: string | null;
  ai_provider: string | null;
  ai_cost: number;
  created_at: string;
  completed_at: string | null;
  is_draft: number;
  is_published: number;
  subject: string;
  subtopics: string;
  username?: string;
}

export interface UsageRow {
  id: string;
  user_id: string;
  exam_id: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  created_at: string;
  username?: string;
}

export interface AIResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ExamQuestion {
  pregunta: string;
  opciones: string[];
  respuesta_correcta: string;
  justificacion: string;
}

export interface PolishMessageRow {
  id: string;
  exam_id: string;
  user_id: string;
  question_index: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ── Fase 0: RAG, Perfil Adaptativo y Persistencia de Chat ──

// Mensaje del chat del tutor — session_id group por conversación, subject nullable
// (llenado retroactivamente por cron nocturno en Fase 5)
export interface ChatLogRow {
  id: string;
  user_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  subject: string | null;
  tokens: number;
  model: string | null;
  is_pinned: number;
  created_at: string;
}

// Embedding del mensaje — vector_text es JSON string del array de floats (4096d para nv-embed-v1)
export interface ChatEmbeddingRow {
  id: string;
  message_id: string;
  user_id: string;
  vector_text: string;
  model: string;
  dimensions: number;
  created_at: string;
}

export interface UsageTotals {
  count: number;
  totalCost: number;
}

export interface AllUsageTotals {
  totalCost: number;
  totalRequests: number;
}
