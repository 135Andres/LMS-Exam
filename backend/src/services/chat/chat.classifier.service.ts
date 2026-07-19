// backend/src/services/chat/chat.classifier.service.ts
import { detectSubjectByKeywords, stripAccents } from '../../utils/subject-keywords.js';

export type Complexity = 'low' | 'medium' | 'high';
export type DelegateTarget = 'glm' | 'sonnet' | 'gemini-pro' | null;

export interface ClassificationResult {
  subject?: string;
  complexity: Complexity;
  delegateTo: DelegateTarget;
  hasCode: boolean;
  method: 'heuristic' | 'llm-fallback';
}

const CODE_PATTERNS = [
  /```/,
  /\b(function|const|let|var|def|class|import|public static|SELECT .* FROM)\b/i,
  /\.(js|ts|py|java|cpp|cs|go|rs|sql|html|css)\b/i,
  /\b(bug|error de compilacion|stack trace|refactor|debuggear|traceback)\b/i,
];

const HIGH_COMPLEXITY_MARKERS = [
  'demuestra', 'demostracion', 'analiza a profundidad', 'analisis detallado',
  'redacta un ensayo', 'compara y contrasta', 'argumenta',
  'desarrolla el tema', 'critica', 'fundamenta tu respuesta', 'elabora un caso',
];

const LOW_COMPLEXITY_MARKERS = [
  'que es', 'define', 'definicion de', 'cuando fue', 'cual es', 'traduce',
];

// Pedido explícito del estudiante de razonamiento extenso — fuerza 'high'
// sin importar longitud del mensaje (ver estimateComplexity).
const EXPLICIT_MAX_EFFORT_MARKERS = [
  'razona', 'razonamiento extenso', 'razonamiento profundo', 'razonamiento maximo',
  'responde detalladamente', 'explica detalladamente', 'explicacion detallada',
  'piensa detenidamente', 'piensalo bien', 'analiza a fondo',
];

const RAG_CONTEXT_LENGTH_FOR_GEMINI = 4000;

export function hasCode(message: string): boolean {
  return CODE_PATTERNS.some(re => re.test(message));
}

export function detectSubjectExtended(query: string): string | undefined {
  return detectSubjectByKeywords(query);
}

function estimateComplexity(message: string): Complexity {
  const lower = stripAccents(message.toLowerCase());
  const len = message.length;

  if (EXPLICIT_MAX_EFFORT_MARKERS.some(m => lower.includes(m))) return 'high';
  if (HIGH_COMPLEXITY_MARKERS.some(m => lower.includes(m)) || len > 600) return 'high';
  if (LOW_COMPLEXITY_MARKERS.some(m => lower.includes(m)) || len < 80) return 'low';
  return 'medium';
}

// Síncrona, sin llamadas de red — se ejecuta antes de armar el prompt.
export function classifyMessage(message: string, ragContextLength: number): ClassificationResult {
  const code = hasCode(message);
  const subject = detectSubjectExtended(message);
  const complexity = estimateComplexity(message);

  let delegateTo: DelegateTarget = null;
  if (code) delegateTo = 'glm';
  else if (complexity === 'high' && ragContextLength > RAG_CONTEXT_LENGTH_FOR_GEMINI) delegateTo = 'gemini-pro';
  else if (complexity === 'high') delegateTo = 'sonnet';

  return { subject, complexity, delegateTo, hasCode: code, method: 'heuristic' };
}
