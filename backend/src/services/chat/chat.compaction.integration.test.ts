// backend/src/services/chat/chat.compaction.integration.test.ts
//
// Integración real del escenario que motivó el rediseño de Fase 2: una
// explicación larga de "integración por partes" (código + LaTeX, por lo
// tanto verificable) rodeada de mensajes narrativos cortos. A diferencia de
// chat.compaction.service.test.ts (todo mockeado), acá corren de verdad
// segmentMessages, extractBlocks, verifyCompaction y SessionSummaryService
// (lee/escribe en data/session-summaries/ de verdad). Solo se mockea
// generateFromAI (llamada de red a la IA) y ChatModel (fuente de mensajes).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { generateFromAIMock, chatModelMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
  chatModelMock: {
    getSummaryCursor: vi.fn(),
    getMessagesSince: vi.fn(),
    setSummaryCursor: vi.fn(),
    getLastAssistantModel: vi.fn(),
  },
}));

vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

vi.mock('../../models/chat.model.js', () => ({
  ChatModel: chatModelMock,
}));

import { compactSession } from './chat.compaction.service.js';
import { SessionSummaryService } from '../session-summary.service.js';

const SESSION_ID = 'compaction-integration-test-session';

const CODE_FENCE_OPEN = '```python';
const CODE_FENCE_CLOSE = '```';
const CODE_LINE = 'def integrate_by_parts(u, dv):';
const MATH_LINE = '$$\\int u \\, dv = uv - \\int v \\, du$$';

const EXPLICACION = [
  'Para resolver la integral por partes usamos la fórmula:',
  '',
  MATH_LINE,
  '',
  'Ejemplo en código:',
  '',
  CODE_FENCE_OPEN,
  CODE_LINE,
  '    return u * dv - integral(dv, u)',
  CODE_FENCE_CLOSE,
  '',
  'Así se aplica la integración por partes paso a paso.',
].join('\n');

const MESSAGES = [
  { id: 'n1', role: 'user', content: 'ok, tengo una duda', created_at: '2026-07-18T10:00:00Z' },
  { id: 'v1', role: 'assistant', content: EXPLICACION, created_at: '2026-07-18T10:00:30Z' },
  { id: 'n2', role: 'user', content: 'gracias', created_at: '2026-07-18T10:01:00Z' },
  { id: 'n3', role: 'assistant', content: 'perfecto, avisame', created_at: '2026-07-18T10:01:10Z' },
];

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 10, completionTokens: 10 }, finishReason: 'stop' };
}

// Simula las 3 llamadas de red reales que hace el pipeline (título de bloque,
// compactación narrativa, verificación cruzada) sin pegarle a la IA de
// verdad. Se distingue por el system prompt de cada paso.
function setupAiMock() {
  generateFromAIMock.mockReset();
  generateFromAIMock.mockImplementation(async (_provider: string, systemPrompt: string, userPrompt: unknown) => {
    if (systemPrompt.includes('título corto')) {
      // Batch de títulos: un item por id (id: ..., [requiere materia]) en el
      // userPrompt, todos reciben el mismo título fijo en este escenario.
      const ids = typeof userPrompt === 'string'
        ? [...userPrompt.matchAll(/\(id: ([^,)]+)/g)].map(m => m[1])
        : [];
      return aiResponse(JSON.stringify({
        items: ids.map(id => ({ id, title: 'Integración por partes' })),
      }));
    }
    if (systemPrompt.includes('auditor de compactación')) {
      return aiResponse(JSON.stringify({ missing: [] }));
    }
    // Paso 3 (compactación narrativa): el prompt ya trae la referencia al
    // bloque real (id generado por SessionSummaryService.addBlock), la
    // "IA" simulada la reusa en vez de repetir el contenido del bloque.
    const match = typeof userPrompt === 'string' ? userPrompt.match(/- (block_[a-f0-9-]+): "([^"]+)"/) : null;
    const ref = match ? `Ver bloque ${match[1]} ("${match[2]}") para la derivación completa.` : '(sin bloques)';
    return aiResponse(JSON.stringify({
      summary: `El estudiante preguntó sobre integración por partes. ${ref} Agradeció la explicación.`,
      confidence: 'high',
    }));
  });
}

describe('compactSession — integración real (dos pistas, escenario "integración por partes")', () => {
  beforeEach(() => {
    setupAiMock();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue(null);
  });

  afterEach(() => {
    SessionSummaryService.deleteSummary(SESSION_ID);
  });

  it('extrae el bloque verbatim, la narrativa lo referencia por id (no repite el contenido), y getBlocks lo devuelve completo', async () => {
    // userId vacío: evita que extractBlocks toque la KB colectiva real
    // (KnowledgeModel), que es un flujo fuera de alcance de este test.
    await compactSession(SESSION_ID, '', true);

    const blocks = SessionSummaryService.getBlocks(SESSION_ID);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.extractedFromMessages).toEqual(['v1']);
    expect(block.title).toBe('Integración por partes');
    // Casi-verbatim: el contenido original completo, sin reformular.
    expect(block.content).toBe(EXPLICACION);
    expect(block.content).toContain(MATH_LINE);
    expect(block.content).toContain(CODE_LINE);

    const narrative = SessionSummaryService.getNarrative(SESSION_ID);
    expect(narrative).not.toBeNull();
    expect(narrative).toContain(block.id);
    // La narrativa referencia el bloque, no repite su contenido verbatim.
    expect(narrative).not.toContain(CODE_LINE);
    expect(narrative).not.toContain(MATH_LINE);

    // getBlocks vuelve a devolver el bloque completo tras la compactación.
    const blocksAfter = SessionSummaryService.getBlocks(SESSION_ID);
    expect(blocksAfter).toHaveLength(1);
    expect(blocksAfter[0].content).toBe(EXPLICACION);

    expect(chatModelMock.setSummaryCursor).toHaveBeenCalledWith(SESSION_ID, MESSAGES[3].created_at);
  });
});
