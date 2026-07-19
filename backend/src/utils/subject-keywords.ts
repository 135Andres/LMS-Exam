// backend/src/utils/subject-keywords.ts
// Fuente única de materias/keywords — antes duplicada en chat.classifier.service.ts
// y knowledge-detection.service.ts (con listas divergentes). Unificada por Task 3
// del plan de fase 3 tomando la unión de ambas listas originales.
export const SUBJECT_KEYWORDS: Record<string, string[]> = {
  matematicas: ['derivada', 'integral', 'limite', 'ecuacion', 'funcion', 'matriz', 'vector', 'probabilidad', 'estadistica', 'geometria', 'trigonometria', 'calculo', 'algebra', 'matematica'],
  fisica: ['fuerza', 'energia', 'velocidad', 'aceleracion', 'newton', 'cinematica', 'dinamica', 'termodinamica', 'electricidad', 'magnetismo', 'optica', 'ondas', 'fisica', 'movimiento'],
  quimica: ['molecula', 'atomo', 'reaccion', 'enlace', 'acido', 'ph', 'estequiometria', 'tabla periodica', 'orbital', 'quimica', 'elemento', 'compuesto'],
  biologia: ['celula', 'adn', 'proteina', 'evolucion', 'ecosistema', 'fotosintesis', 'mitosis', 'meiosis', 'biologia', 'genetica', 'organismo'],
  historia: ['guerra', 'revolucion', 'imperio', 'siglo', 'tratado', 'independencia', 'constitucion', 'historia', 'civilizacion'],
  lenguaje: ['sintaxis', 'gramatica', 'verbo', 'sustantivo', 'adjetivo', 'oracion', 'texto', 'lectura', 'escritura', 'espanol', 'literatura', 'ortografia', 'redaccion'],
  informatica: ['algoritmo', 'codigo', 'programa', 'variable', 'bucle', 'array', 'objeto', 'clase', 'api', 'base de datos'],
  derecho: ['jurisprudencia', 'codigo civil', 'codigo penal', 'amparo', 'contrato', 'demanda', 'jurisdiccion', 'constitucional', 'litigio', 'tribunal', 'sentencia'],
  contaduria: ['balance general', 'estado de resultados', 'activo', 'pasivo', 'depreciacion', 'impuestos', 'iva', 'isr', 'partida doble', 'flujo de efectivo', 'contabilidad'],
  administracion: ['marketing', 'mercadotecnia', 'foda', 'kpi', 'presupuesto', 'organigrama', 'logistica', 'cadena de suministro', 'recursos humanos'],
  economia: ['oferta y demanda', 'pib', 'inflacion', 'mercado', 'macroeconomia', 'microeconomia', 'tasa de interes'],
  psicologia: ['conducta', 'cognitivo', 'terapia', 'trastorno', 'desarrollo psicosocial', 'freud', 'piaget', 'psicoanalisis'],
  medicina: ['diagnostico', 'sintoma', 'patologia', 'farmaco', 'anatomia', 'sistema nervioso', 'sistema circulatorio', 'clinico'],
  ingenieria: ['resistencia de materiales', 'circuito', 'esfuerzo', 'termodinamica aplicada', 'planos', 'cad', 'estructural'],
  artes: ['composicion', 'perspectiva', 'boceto', 'paleta', 'movimiento artistico', 'renacimiento', 'barroco', 'diseno grafico'],
  filosofia: ['etica', 'epistemologia', 'metafisica', 'kant', 'aristoteles', 'existencialismo', 'ontologia'],
  ciencias_politicas: ['estado', 'gobierno', 'politica publica', 'sociedad', 'democracia', 'ideologia', 'geopolitica'],
  pedagogia: ['curriculo', 'didactica', 'aprendizaje significativo', 'evaluacion formativa', 'plan de estudios'],
  estadistica: ['hipotesis', 'muestra', 'varianza', 'regresion', 'chi cuadrada', 'desviacion estandar', 'intervalo de confianza'],
};

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

// Detección compartida de materia por keywords — usada por
// chat.classifier.service.ts y knowledge-detection.service.ts. El texto de
// entrada debe venir ya en minúsculas; esta función se encarga de quitar
// tildes antes de matchear.
export function detectSubjectByKeywords(text: string): string | undefined {
  const normalized = stripAccents(text.toLowerCase());
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (keywords.some(kw => matchesKeyword(normalized, kw))) return subject;
  }
  return undefined;
}
