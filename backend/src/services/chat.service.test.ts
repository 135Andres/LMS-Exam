import { describe, it, expect } from 'vitest';
import { buildContent } from './chat.service.js';
import type { Attachment } from '../validators/chat.js';

describe('buildContent', () => {
  it('returns text-only content when no attachments', async () => {
    const result = await buildContent('Hola mundo');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].text).toBe('Hola mundo');
  });

  it('returns text-only content when attachments array is empty', async () => {
    const result = await buildContent('Hola', []);
    expect(result).toHaveLength(1);
  });

  it('includes image attachment as image_url', async () => {
    const att: Attachment = { type: 'image', mime: 'image/png', data: 'abc123' };
    const result = await buildContent('msg', [att]);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('image_url');
  });

  it('includes audio attachment as audio_url', async () => {
    const att: Attachment = { type: 'audio', mime: 'audio/wav', data: 'abc123' };
    const result = await buildContent('msg', [att]);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('audio_url');
  });

  it('includes file attachment as text with extracted content', async () => {
    const att: Attachment = { type: 'file', mime: 'text/plain', data: Buffer.from('Hello PDF content').toString('base64') };
    const result = await buildContent('msg', [att]);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('text');
    const fileText = result[1].text as string;
    expect(fileText).toContain('Contenido del archivo adjunto');
    expect(fileText).toContain('Hello PDF content');
  });

  it('returns fallback message for PDF with no extractable text', async () => {
    const att: Attachment = { type: 'file', mime: 'application/pdf', data: Buffer.from('fake').toString('base64') };
    const result = await buildContent('msg', [att]);
    expect(result).toHaveLength(2);
    const fileText = result[1].text as string;
    expect(fileText).toContain('No se pudo extraer texto');
  });

  it('handles multiple attachments of different types', async () => {
    const atts: Attachment[] = [
      { type: 'image', mime: 'image/png', data: 'img' },
      { type: 'file', mime: 'text/plain', data: Buffer.from('doc content').toString('base64') },
      { type: 'audio', mime: 'audio/wav', data: 'snd' },
    ];
    const result = await buildContent('msg', atts);
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('image_url');
    expect(result[2].type).toBe('text');
    expect(result[2].text).toContain('doc content');
    expect(result[3].type).toBe('audio_url');
  });
});
