import { SUBJECT_KEYWORDS, stripAccents } from '../utils/subject-keywords.js';

export const ONBOARDING_TOTAL_STEPS = 5;

export interface OnboardingChip {
  value: string;
  label: string;
  preview?: string;
}

export interface OnboardingInputSpec {
  id: string;
  kind: 'single' | 'multi' | 'text';
  options?: OnboardingChip[];
  // Campo con salida de texto libre además de/en vez de las opciones sugeridas
  // (display_name, field, "Otra" materia). Si false, un valor sin match se rechaza.
  allowFreeText?: boolean;
}

export interface OnboardingStepPayload {
  type: 'onboarding_step';
  step: number;
  total: number;
  prompt: string;
  inputs: OnboardingInputSpec[];
  note?: string;
}

export interface OnboardingStepContext {
  suggestedDisplayName?: string;
}

function subjectLabel(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Misma fuente de verdad que el detector de materias del chat (subject-keywords.ts)
// — las 19 materias generadas en runtime, sin lista paralela que se desincronice.
// Exportada (no solo usada internamente) para que settings (plan 06) sirva las
// mismas opciones que el wizard vía GET, en vez de duplicar la lista.
export function subjectOptions(): OnboardingChip[] {
  return [
    ...Object.keys(SUBJECT_KEYWORDS).map(key => ({ value: key, label: subjectLabel(key) })),
    { value: 'otra', label: 'Otra…' },
  ];
}

// Opciones de cada campo enum — única fuente de verdad, reusada por el wizard
// (buildStep) y por el GET de opciones de Settings → Perfil de estudio (plan 06).
export const LEVEL_OPTIONS: OnboardingChip[] = [
  { value: 'prepa', label: 'Prepa' },
  { value: 'uni', label: 'Universidad' },
  { value: 'posgrado', label: 'Posgrado' },
  { value: 'otro', label: 'Otro' },
];

export const FIELD_SUGGESTIONS: OnboardingChip[] = [
  { value: 'Ingeniería', label: 'Ingeniería' },
  { value: 'Medicina', label: 'Medicina' },
  { value: 'Derecho', label: 'Derecho' },
  { value: 'Ciencias', label: 'Ciencias' },
  { value: 'Humanidades', label: 'Humanidades' },
  { value: 'Negocios', label: 'Negocios' },
];

export const GOAL_OPTIONS: OnboardingChip[] = [
  { value: 'examenes', label: 'Pasar exámenes' },
  { value: 'entender', label: 'Entender los temas' },
  { value: 'tareas', label: 'Hacer tareas' },
  { value: 'repaso', label: 'Repasar' },
  { value: 'mixto', label: 'Un poco de todo' },
];

export const DEPTH_OPTIONS: OnboardingChip[] = [
  { value: 'breve', label: 'Directas y breves', preview: 'Al grano: resultado, fórmula, listo.' },
  { value: 'detallado', label: 'Detalladas siempre', preview: 'Contexto completo, cada paso justificado.' },
  { value: 'auto', label: 'Según el tema', preview: 'Yo decido por complejidad.' },
];

export const REGISTER_OPTIONS: OnboardingChip[] = [
  { value: 'tuteo', label: 'Háblame de tú' },
  { value: 'formal', label: 'Háblame de usted' },
  { value: 'neutro', label: 'Solo dame la información' },
];

// Todas las opciones de campos enum del perfil, para el GET de Settings →
// Perfil de estudio (plan 06) — mismos chips que ve el wizard, una sola fuente.
export function getProfileFieldOptions() {
  return {
    levels: LEVEL_OPTIONS,
    fieldSuggestions: FIELD_SUGGESTIONS,
    subjects: subjectOptions(),
    goals: GOAL_OPTIONS,
    depths: DEPTH_OPTIONS,
    registers: REGISTER_OPTIONS,
  };
}

function buildStep(step: number, ctx: OnboardingStepContext): Omit<OnboardingStepPayload, 'type'> {
  switch (step) {
    case 1:
      return {
        step: 1,
        total: ONBOARDING_TOTAL_STEPS,
        prompt: '¿Cómo te llamas?',
        inputs: [
          {
            id: 'display_name',
            kind: 'text',
            allowFreeText: true,
            options: ctx.suggestedDisplayName
              ? [{ value: ctx.suggestedDisplayName, label: 'Así está bien' }]
              : [],
          },
        ],
      };
    case 2:
      return {
        step: 2,
        total: ONBOARDING_TOTAL_STEPS,
        prompt: '¿En qué nivel estás y qué estudias?',
        inputs: [
          { id: 'level', kind: 'single', options: LEVEL_OPTIONS },
          { id: 'field', kind: 'text', allowFreeText: true, options: FIELD_SUGGESTIONS },
        ],
      };
    case 3:
      return {
        step: 3,
        total: ONBOARDING_TOTAL_STEPS,
        prompt: '¿Qué materias estudias?',
        inputs: [
          { id: 'subjects', kind: 'multi', allowFreeText: true, options: subjectOptions() },
        ],
      };
    case 4:
      return {
        step: 4,
        total: ONBOARDING_TOTAL_STEPS,
        prompt: '¿Cuál es tu objetivo principal en el chat?',
        inputs: [
          { id: 'goal', kind: 'single', options: GOAL_OPTIONS },
        ],
      };
    case 5:
      return {
        step: 5,
        total: ONBOARDING_TOTAL_STEPS,
        prompt: '¿Cómo prefieres mis respuestas?',
        inputs: [
          { id: 'depth', kind: 'single', options: DEPTH_OPTIONS },
          { id: 'register', kind: 'single', options: REGISTER_OPTIONS },
        ],
      };
    default:
      throw new Error(`Paso de onboarding inválido: ${step}`);
  }
}

export function getStepPayload(step: number, ctx: OnboardingStepContext = {}, note?: string): OnboardingStepPayload {
  const clamped = Math.min(Math.max(step, 1), ONBOARDING_TOTAL_STEPS);
  return { type: 'onboarding_step', ...buildStep(clamped, ctx), ...(note ? { note } : {}) };
}

function normalize(text: string): string {
  return stripAccents(text.trim().toLowerCase());
}

// Match EXACTO (lowercase, sin acentos) — para campos 'text' (display_name,
// field): un chip sugerido solo debe resolverse si el usuario mandó
// justo ese valor/label, nunca por "contains" (un nombre real puede
// contener el nombre sugerido como substring sin ser la misma respuesta).
export function matchChipExact(raw: string, options: OnboardingChip[]): string | null {
  const norm = normalize(raw);
  if (!norm) return null;
  const hit = options.find(opt => normalize(opt.value) === norm || normalize(opt.label) === norm);
  return hit?.value ?? null;
}

// Matching lowercase+contains contra labels/values — para cuando el usuario
// responde en texto libre sobre un paso de chips en vez de mandar el value tal cual.
export function matchChipAnswer(raw: string, options: OnboardingChip[]): string | null {
  const norm = normalize(raw);
  if (!norm) return null;

  for (const opt of options) {
    const value = normalize(opt.value);
    const label = normalize(opt.label);
    if (norm === value || norm === label) return opt.value;
  }
  for (const opt of options) {
    const value = normalize(opt.value);
    const label = normalize(opt.label);
    if ((value && (norm.includes(value) || value.includes(norm))) || (label && (norm.includes(label) || label.includes(norm)))) {
      return opt.value;
    }
  }
  return null;
}
