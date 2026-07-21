import { describe, it, expect } from 'vitest';
import { chatMessageSchema, attachmentSchema, summaryUpdateSchema } from './chat.js';

describe('chatMessageSchema', () => {
  it('accepts valid message', () => {
    const r = chatMessageSchema.safeParse({ message: 'Hola' });
    expect(r.success).toBe(true);
  });

  it('rejects empty message', () => {
    const r = chatMessageSchema.safeParse({ message: '' });
    expect(r.success).toBe(false);
  });

  it('accepts valid UUID v4 sessionId', () => {
    const r = chatMessageSchema.safeParse({ message: 'hi', sessionId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(r.success).toBe(true);
  });

  it('rejects non-v4 UUID sessionId', () => {
    const r = chatMessageSchema.safeParse({ message: 'hi', sessionId: '550e8400-e29b-11d4-a716-446655440000' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid sessionId', () => {
    const r = chatMessageSchema.safeParse({ message: 'hi', sessionId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('accepts optional sessionId absent', () => {
    const r = chatMessageSchema.safeParse({ message: 'hi' });
    expect(r.success).toBe(true);
  });

  it('accepts attachments with image type', () => {
    const r = chatMessageSchema.safeParse({
      message: 'hi',
      attachments: [{ type: 'image', mime: 'image/png', data: 'base64...' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts attachments with file type', () => {
    const r = chatMessageSchema.safeParse({
      message: 'hi',
      attachments: [{ type: 'file', mime: 'application/pdf', data: 'base64...' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects more than 5 attachments', () => {
    const atts = Array(6).fill({ type: 'image', mime: 'image/png', data: 'x' });
    const r = chatMessageSchema.safeParse({ message: 'hi', attachments: atts });
    expect(r.success).toBe(false);
  });
});

describe('attachmentSchema', () => {
  it('accepts image', () => {
    expect(attachmentSchema.safeParse({ type: 'image', mime: 'image/png', data: 'x' }).success).toBe(true);
  });

  it('accepts audio', () => {
    expect(attachmentSchema.safeParse({ type: 'audio', mime: 'audio/wav', data: 'x' }).success).toBe(true);
  });

  it('accepts file', () => {
    expect(attachmentSchema.safeParse({ type: 'file', mime: 'application/pdf', data: 'x' }).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(attachmentSchema.safeParse({ type: 'video', mime: 'video/mp4', data: 'x' }).success).toBe(false);
  });
});

describe('summaryUpdateSchema (Fase 4 — edición manual del resumen)', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts valid sessionId + content', () => {
    const r = summaryUpdateSchema.safeParse({ sessionId: validSessionId, content: 'narrativa editada a mano' });
    expect(r.success).toBe(true);
  });

  it('rejects empty content', () => {
    const r = summaryUpdateSchema.safeParse({ sessionId: validSessionId, content: '' });
    expect(r.success).toBe(false);
  });

  it('rejects content que excede el tope de 20000 caracteres', () => {
    const r = summaryUpdateSchema.safeParse({ sessionId: validSessionId, content: 'a'.repeat(20001) });
    expect(r.success).toBe(false);
  });

  it('accepts content en el límite exacto de 20000 caracteres', () => {
    const r = summaryUpdateSchema.safeParse({ sessionId: validSessionId, content: 'a'.repeat(20000) });
    expect(r.success).toBe(true);
  });

  it('rejects sessionId inválido', () => {
    const r = summaryUpdateSchema.safeParse({ sessionId: 'not-a-uuid', content: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects sessionId ausente', () => {
    const r = summaryUpdateSchema.safeParse({ content: 'x' });
    expect(r.success).toBe(false);
  });
});
