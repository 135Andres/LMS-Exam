// backend/src/services/chat/chat.classifier.service.ts
export type Complexity = 'low' | 'medium' | 'high';
export type DelegateTarget = 'glm' | 'sonnet' | 'gemini-pro' | null;

export interface ClassificationResult {
  subject?: string;
  complexity: Complexity;
  delegateTo: DelegateTarget;
  hasCode: boolean;
  method: 'heuristic' | 'llm-fallback';
}

// Fuente única de materias — HybridRAGService.detectSubject() importa esta
// misma constante para que las dos listas no diverjan.
export const SUBJECT_KEYWORDS: Record<string, string[]> = {
  matematicas: ['derivada', 'integral', 'limite', 'ecuacion', 'funcion', 'matriz', 'vector', 'probabilidad', 'estadistica', 'geometria', 'trigonometria', 'calculo', 'algebra'],
  fisica: ['fuerza', 'energia', 'velocidad', 'aceleracion', 'newton', 'cinematica', 'dinamica', 'termodinamica', 'electricidad', 'magnetismo', 'optica', 'ondas'],
  quimica: ['molecula', 'atomo', 'reaccion', 'enlace', 'acido', 'base', 'ph', 'estequiometria', 'tabla periodica', 'orbital'],
  biologia: ['celula', 'adn', 'gen', 'proteina', 'evolucion', 'ecosistema', 'fotosintesis', 'mitosis', 'meiosis'],
  historia: ['guerra', 'revolucion', 'imperio', 'siglo', 'tratado', 'independencia', 'constitucion'],
  lenguaje: ['sintaxis', 'gramatica', 'verbo', 'sustantivo', 'adjetivo', 'oracion', 'texto', 'lectura', 'escritura'],
  informatica: ['algoritmo', 'codigo', 'programa', 'variable', 'bucle', 'array', 'objeto', 'clase', 'api', 'base de datos'],
  derecho: ['jurisprudencia', 'codigo civil', 'codigo penal', 'amparo', 'contrato', 'demanda', 'jurisdiccion', 'constitucional', 'litigio', 'tribunal', 'sentencia'],
  contaduria: ['balance general', 'estado de resultados', 'activo', 'pasivo', 'depreciacion', 'impuestos', 'iva', 'isr', 'partida doble', 'flujo de efectivo', 'contabilidad'],
  administracion: ['marketing', 'mercadotecnia', 'foda', 'kpi', 'presupuesto', 'organigrama', 'logistica', 'cadena de suministro', 'recursos humanos'],
  economia: ['oferta y demanda', 'pib', 'inflacion', 'mercado', 'macroeconomia', 'microeconomia', 'tasa de interes'],
  psicologia: ['conducta', 'cognitivo', 'terapia', 'trastorno', 'desarrollo psicosocial', 'freud', 'piaget', 'psicoanalisis'],
  medicina: ['diagnostico', 'sintoma', 'patologia', 'farmaco', 'anatomia', 'sistema nervioso', 'sistema circulatorio', 'clinico'],
  ingenieria: ['resistencia de materiales', 'circuito', 'esfuerzo', 'termodinamica aplicada', 'planos', 'cad', 'estructural'],
  artes: ['composicion', 'perspectiva', 'boceto', 'paleta', 'movimiento artistico', 'renacimiento', 'barroco', 'diseño grafico'],
  filosofia: ['etica', 'epistemologia', 'metafisica', 'kant', 'aristoteles', 'existencialismo', 'ontologia'],
  ciencias_politicas: ['estado', 'gobierno', 'politica publica', 'sociedad', 'democracia', 'ideologia', 'geopolitica'],
  pedagogia: ['curriculo', 'didactica', 'aprendizaje significativo', 'evaluacion formativa', 'plan de estudios'],
  estadistica: ['hipotesis', 'muestra', 'varianza', 'regresion', 'chi cuadrada', 'desviacion estandar', 'intervalo de confianza'],
};

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

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function hasCode(message: string): boolean {
  return CODE_PATTERNS.some(re => re.test(message));
}

export function detectSubjectExtended(query: string): string | undefined {
  const lower = stripAccents(query.toLowerCase());
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (keywords.some(k => lower.includes(stripAccents(k)))) return subject;
  }
  return undefined;
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
