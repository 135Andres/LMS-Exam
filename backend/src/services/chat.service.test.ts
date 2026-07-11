import { describe, it, expect } from 'vitest';
import { buildContent } from './chat.service.js';
import type { Attachment } from '../validators/chat.js';

describe('buildContent', () => {
  it('returns text-only content when no attachments', () => {
    const result = buildContent('Hola mundo');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].text).toBe('Hola mundo');
  });

  it('returns text-only content when attachments array is empty', () => {
    const result = buildContent('Hola', []);
    expect(result).toHaveLength(1);
  });

  it('includes image attachment as image_url', () => {
    const att: Attachment = { type: 'image', mime: 'image/png', data: 'abc123' };
    const result = buildContent('msg', [att]);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('image_url');
  });

  it('includes audio attachment as audio_url', () => {
    const att: Attachment = { type: 'audio', mime: 'audio/wav', data: 'abc123' };
    const result = buildContent('msg', [att]);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('audio_url');
  });

  it('includes file attachment as text (not silently dropped)', () => {
    const att: Attachment = { type: 'file', mime: 'application/pdf', data: 'base64data' };
    const result = buildContent('msg', [att]);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('text');
    const fileText = result[1].text as string;
    expect(fileText).toContain('Archivo adjunto');
    expect(fileText).toContain('application/pdf');
  });

  it('handles multiple attachments of different types', () => {
    const atts: Attachment[] = [
      { type: 'image', mime: 'image/png', data: 'img' },
      { type: 'file', mime: 'application/pdf', data: 'doc' },
      { type: 'audio', mime: 'audio/wav', data: 'snd' },
    ];
    const result = buildContent('msg', atts);
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('image_url');
    expect(result[2].type).toBe('text');
    expect(result[2].text).toContain('Archivo adjunto');
    expect(result[3].type).toBe('audio_url');
  });
});
