// backend/src/utils/subject-keywords.ts
// Fuente única de materias/keywords — antes duplicada en chat.classifier.service.ts
// y knowledge-detection.service.ts (con listas divergentes). Unificada por Task 3
// del plan de fase 3 tomando la unión de ambas listas originales.

interface KeywordEntry {
  keyword: string;
  // Palabra suelta genérica que aparece en el uso cotidiano fuera de la
  // materia (ej. "movimiento", "siglo", "estado") — pesa menos que una
  // keyword técnica o una frase de 2+ palabras, para que no le gane a una
  // materia con matches más específicos solo por el orden del diccionario.
  weak?: boolean;
}

const SUBJECT_KEYWORD_ENTRIES: Record<string, KeywordEntry[]> = {
  matematicas: [
    { keyword: 'derivada' }, { keyword: 'integral' }, { keyword: 'limite', weak: true },
    { keyword: 'ecuacion' }, { keyword: 'funcion', weak: true }, { keyword: 'matriz', weak: true },
    { keyword: 'vector' }, { keyword: 'probabilidad' }, { keyword: 'estadistica' },
    { keyword: 'geometria' }, { keyword: 'trigonometria' }, { keyword: 'calculo', weak: true },
    { keyword: 'algebra' }, { keyword: 'matematica' },
  ],
  fisica: [
    { keyword: 'fuerza', weak: true }, { keyword: 'energia', weak: true }, { keyword: 'velocidad', weak: true },
    { keyword: 'aceleracion' }, { keyword: 'newton' }, { keyword: 'cinematica' }, { keyword: 'dinamica' },
    { keyword: 'termodinamica' }, { keyword: 'electricidad' }, { keyword: 'magnetismo' }, { keyword: 'optica' },
    { keyword: 'ondas' }, { keyword: 'fisica' }, { keyword: 'movimiento', weak: true },
  ],
  quimica: [
    { keyword: 'molecula' }, { keyword: 'atomo' }, { keyword: 'reaccion' }, { keyword: 'enlace' },
    { keyword: 'acido' }, { keyword: 'ph' }, { keyword: 'estequiometria' }, { keyword: 'tabla periodica' },
    { keyword: 'orbital' }, { keyword: 'quimica' }, { keyword: 'elemento', weak: true }, { keyword: 'compuesto', weak: true },
  ],
  biologia: [
    { keyword: 'celula' }, { keyword: 'adn' }, { keyword: 'proteina' }, { keyword: 'evolucion' },
    { keyword: 'ecosistema' }, { keyword: 'fotosintesis' }, { keyword: 'mitosis' }, { keyword: 'meiosis' },
    { keyword: 'biologia' }, { keyword: 'genetica' }, { keyword: 'organismo', weak: true },
  ],
  historia: [
    { keyword: 'guerra', weak: true }, { keyword: 'revolucion' }, { keyword: 'imperio' }, { keyword: 'siglo', weak: true },
    { keyword: 'tratado', weak: true }, { keyword: 'independencia' }, { keyword: 'constitucion' },
    { keyword: 'historia' }, { keyword: 'civilizacion' },
  ],
  lenguaje: [
    { keyword: 'sintaxis' }, { keyword: 'gramatica' }, { keyword: 'verbo' }, { keyword: 'sustantivo' },
    { keyword: 'adjetivo' }, { keyword: 'oracion' }, { keyword: 'texto', weak: true }, { keyword: 'lectura', weak: true },
    { keyword: 'escritura', weak: true }, { keyword: 'espanol' }, { keyword: 'literatura' },
    { keyword: 'ortografia' }, { keyword: 'redaccion' },
  ],
  informatica: [
    { keyword: 'algoritmo' }, { keyword: 'codigo' }, { keyword: 'programa' }, { keyword: 'variable', weak: true },
    { keyword: 'bucle' }, { keyword: 'array' }, { keyword: 'objeto', weak: true }, { keyword: 'clase', weak: true },
    { keyword: 'api' }, { keyword: 'base de datos' },
  ],
  derecho: [
    { keyword: 'jurisprudencia' }, { keyword: 'codigo civil' }, { keyword: 'codigo penal' }, { keyword: 'amparo' },
    { keyword: 'contrato', weak: true }, { keyword: 'demanda', weak: true }, { keyword: 'jurisdiccion' },
    { keyword: 'constitucional' }, { keyword: 'litigio' }, { keyword: 'tribunal' }, { keyword: 'sentencia' },
  ],
  contaduria: [
    { keyword: 'balance general' }, { keyword: 'estado de resultados' }, { keyword: 'activo', weak: true },
    { keyword: 'pasivo', weak: true }, { keyword: 'depreciacion' }, { keyword: 'impuestos' }, { keyword: 'iva' },
    { keyword: 'isr' }, { keyword: 'partida doble' }, { keyword: 'flujo de efectivo' }, { keyword: 'contabilidad' },
  ],
  administracion: [
    { keyword: 'marketing' }, { keyword: 'mercadotecnia' }, { keyword: 'foda' }, { keyword: 'kpi' },
    { keyword: 'presupuesto', weak: true }, { keyword: 'organigrama' }, { keyword: 'logistica' },
    { keyword: 'cadena de suministro' }, { keyword: 'recursos humanos' },
  ],
  economia: [
    { keyword: 'oferta y demanda' }, { keyword: 'pib' }, { keyword: 'inflacion' }, { keyword: 'mercado', weak: true },
    { keyword: 'macroeconomia' }, { keyword: 'microeconomia' }, { keyword: 'tasa de interes' },
  ],
  psicologia: [
    { keyword: 'conducta', weak: true }, { keyword: 'cognitivo' }, { keyword: 'terapia' }, { keyword: 'trastorno' },
    { keyword: 'desarrollo psicosocial' }, { keyword: 'freud' }, { keyword: 'piaget' }, { keyword: 'psicoanalisis' },
  ],
  medicina: [
    { keyword: 'diagnostico' }, { keyword: 'sintoma' }, { keyword: 'patologia' }, { keyword: 'farmaco' },
    { keyword: 'anatomia' }, { keyword: 'sistema nervioso' }, { keyword: 'sistema circulatorio' }, { keyword: 'clinico', weak: true },
  ],
  ingenieria: [
    { keyword: 'resistencia de materiales' }, { keyword: 'circuito' }, { keyword: 'esfuerzo' },
    { keyword: 'termodinamica aplicada' }, { keyword: 'planos', weak: true }, { keyword: 'cad' }, { keyword: 'estructural' },
  ],
  artes: [
    { keyword: 'composicion' }, { keyword: 'perspectiva' }, { keyword: 'boceto' }, { keyword: 'paleta' },
    { keyword: 'movimiento artistico' }, { keyword: 'movimiento romantico' }, { keyword: 'romanticismo' },
    { keyword: 'renacimiento' }, { keyword: 'barroco' }, { keyword: 'diseno grafico' },
  ],
  filosofia: [
    { keyword: 'etica' }, { keyword: 'epistemologia' }, { keyword: 'metafisica' }, { keyword: 'kant' },
    { keyword: 'aristoteles' }, { keyword: 'existencialismo' }, { keyword: 'ontologia' }, { keyword: 'filosofia' },
  ],
  ciencias_politicas: [
    { keyword: 'estado', weak: true }, { keyword: 'gobierno' }, { keyword: 'politica publica' },
    { keyword: 'sociedad', weak: true }, { keyword: 'democracia' }, { keyword: 'ideologia' }, { keyword: 'geopolitica' },
  ],
  pedagogia: [
    { keyword: 'curriculo', weak: true }, { keyword: 'didactica' }, { keyword: 'aprendizaje significativo' },
    { keyword: 'evaluacion formativa' }, { keyword: 'plan de estudios' },
  ],
  estadistica: [
    { keyword: 'hipotesis', weak: true }, { keyword: 'muestra', weak: true }, { keyword: 'varianza' },
    { keyword: 'regresion' }, { keyword: 'chi cuadrada' }, { keyword: 'desviacion estandar' },
    { keyword: 'intervalo de confianza' },
  ],
};

// Export plano (solo strings) para consumidores que no necesitan el peso —
// mismo shape que antes, así hybrid-rag.service.ts no requiere cambios.
export const SUBJECT_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(SUBJECT_KEYWORD_ENTRIES).map(([subject, entries]) => [subject, entries.map(e => e.keyword)]),
);

// Las keywords de arriba están sin tildes — quien matchee debe normalizar el
// texto de entrada con esta misma función (ver chat.classifier.service.ts y
// knowledge-detection.service.ts) para no perder matches con texto acentuado.
export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matchea keyword como palabra completa (o frase completa), no como substring
// suelto — evita falsos positivos tipo 'api' dentro de "terapia" o 'texto'
// dentro de "contexto" que sí ocurrían con .includes().
function matchesKeyword(normalizedText: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(normalizedText);
}

// Peso de una keyword: una frase de N palabras cuenta N, una palabra suelta
// genérica ("weak") cuenta menos que una palabra técnica sin ambigüedad —
// así un solo match de "movimiento" no le gana a "movimiento romantico" +
// "romanticismo" de otra materia solo por aparecer primero en el diccionario.
function keywordWeight(entry: KeywordEntry): number {
  if (entry.weak) return 0.5;
  return entry.keyword.trim().split(/\s+/).length;
}

export interface SubjectDetectionResult {
  subject: string | undefined;
  confidence: 'high' | 'low';
}

// Boost del perfil de usuario (plan 07) — desempata/refuerza, nunca crea
// señal de la nada: solo se aplica a materias que YA matchearon al menos una
// keyword (score > 0). Un multiplicador chico (no una suma fija) para que el
// efecto sea proporcional al score existente y nunca alcance para tapar una
// diferencia grande como la de "Movimiento Romántico" (frase específica,
// weight 2) vs física (keyword suelta genérica, weight 0.5) — ver test de
// regresión "el boost no secuestra" en subject-keywords.test.ts.
export const PROFILE_SUBJECT_BOOST_MULTIPLIER = 1.2;

// Detección compartida de materia por keywords — usada por
// chat.classifier.service.ts, chat.block-extraction.service.ts y
// knowledge-detection.service.ts. El texto de entrada debe venir ya en
// minúsculas; esta función se encarga de quitar tildes antes de matchear.
//
// A diferencia de la versión anterior (primera materia que matchee, en
// orden de diccionario), acá se suman los pesos de todas las keywords que
// matchean por materia y gana el score más alto — el orden de declaración
// solo desempata scores iguales.
//
// boostSubjects (plan 07): materias declaradas en profile.subjects — reciben
// PROFILE_SUBJECT_BOOST_MULTIPLIER sobre su score ya calculado. Opcional y
// sin efecto si se omite, para no alterar comportamiento en los call sites
// que todavía no tienen perfil a mano (ej. knowledge-detection.service.ts).
export function detectSubjectByKeywords(text: string, boostSubjects?: string[]): SubjectDetectionResult {
  const normalized = stripAccents(text.toLowerCase());
  const boostSet = boostSubjects && boostSubjects.length > 0 ? new Set(boostSubjects) : null;

  const scores: Array<{ subject: string; score: number }> = [];
  for (const [subject, entries] of Object.entries(SUBJECT_KEYWORD_ENTRIES)) {
    let score = 0;
    for (const entry of entries) {
      if (matchesKeyword(normalized, entry.keyword)) score += keywordWeight(entry);
    }
    if (score > 0) {
      if (boostSet?.has(subject)) score *= PROFILE_SUBJECT_BOOST_MULTIPLIER;
      scores.push({ subject, score });
    }
  }

  if (scores.length === 0) return { subject: undefined, confidence: 'low' };

  scores.sort((a, b) => b.score - a.score); // sort estable: empates conservan orden de declaración
  const [best, second] = scores;
  const confidence: 'high' | 'low' =
    best.score >= 1 && (!second || best.score - second.score >= 1) ? 'high' : 'low';

  return { subject: best.subject, confidence };
}
