import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockPdfText = '';
let mockPdfShouldThrow = false;
let mockPdfPages: Array<{ num: number; text: string }> = [];

const mockGetText = () => {
  if (mockPdfShouldThrow) return Promise.reject(new Error('corrupted'));
  return Promise.resolve({ text: mockPdfText, pages: mockPdfPages });
};
const mockDestroy = () => Promise.resolve();

vi.mock('pdf-parse', () => {
  return {
    PDFParse: class MockPDFParse {
      getText = mockGetText;
      destroy = mockDestroy;
    },
  };
});

import { extractAttachmentText } from './attachment-text.js';

function toBase64(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}

describe('extractAttachmentText', () => {
  beforeEach(() => {
    mockPdfText = '';
    mockPdfShouldThrow = false;
    mockPdfPages = [];
  });

  describe('text/plain', () => {
    it('decodes and returns plain text content', async () => {
      const text = 'Hola mundo, este es un archivo de prueba.';
      const result = await extractAttachmentText('text/plain', toBase64(text));
      expect(result).toBe(text);
    });

    it('truncates at MAX_ATTACHMENT_CHARS (8000)', async () => {
      const longText = 'X'.repeat(10000);
      const result = await extractAttachmentText('text/plain', toBase64(longText));
      expect(result).toHaveLength(8000);
    });
  });

  describe('application/json', () => {
    it('decodes and returns JSON content', async () => {
      const json = JSON.stringify({ key: 'value', nested: { a: 1 } });
      const result = await extractAttachmentText('application/json', toBase64(json));
      expect(result).toBe(json);
    });

    it('truncates at MAX_ATTACHMENT_CHARS', async () => {
      const longJson = JSON.stringify({ data: 'Y'.repeat(10000) });
      const result = await extractAttachmentText('application/json', toBase64(longJson));
      expect(result).toHaveLength(8000);
    });
  });

  describe('application/pdf', () => {
    it('returns extracted text when PDF has content', async () => {
      mockPdfText = 'Este es el contenido del PDF.';
      const fakePdf = Buffer.from('fake-pdf-content');
      const result = await extractAttachmentText('application/pdf', fakePdf.toString('base64'));
      expect(result).toBe('Este es el contenido del PDF.');
    });

    it('returns null for scanned PDF with no text', async () => {
      mockPdfText = '';
      const fakePdf = Buffer.from('fake-pdf-content');
      const result = await extractAttachmentText('application/pdf', fakePdf.toString('base64'));
      expect(result).toBeNull();
    });

    it('returns null when pdf-parse throws', async () => {
      mockPdfShouldThrow = true;
      const fakePdf = Buffer.from('corrupted-content');
      const result = await extractAttachmentText('application/pdf', fakePdf.toString('base64'));
      expect(result).toBeNull();
    });

    it('truncates long PDF text at 8000 chars', async () => {
      mockPdfText = 'Z'.repeat(12000);
      const fakePdf = Buffer.from('fake-pdf-content');
      const result = await extractAttachmentText('application/pdf', fakePdf.toString('base64'));
      expect(result).toHaveLength(8000);
    });

    it('uses pages array when available, inserting page markers', async () => {
      mockPdfPages = [
        { num: 1, text: 'Contenido de la página uno.' },
        { num: 2, text: 'Contenido de la página dos.' },
      ];
      const fakePdf = Buffer.from('fake-pdf-content');
      const result = await extractAttachmentText('application/pdf', fakePdf.toString('base64'));
      expect(result).toContain('[Página 1]');
      expect(result).toContain('[Página 2]');
      expect(result).toContain('Contenido de la página uno.');
      expect(result).toContain('Contenido de la página dos.');
      const idx1 = result!.indexOf('[Página 1]');
      const idx2 = result!.indexOf('[Página 2]');
      expect(idx1).toBeLessThan(idx2);
    });

    it('falls back to result.text when pages is empty but text has content', async () => {
      mockPdfText = 'Texto plano sin marcadores de página.';
      mockPdfPages = [];
      const fakePdf = Buffer.from('fake-pdf-content');
      const result = await extractAttachmentText('application/pdf', fakePdf.toString('base64'));
      expect(result).toBe('Texto plano sin marcadores de página.');
    });

    it('truncates long multi-page PDF at 8000 chars over assembled marked text', async () => {
      mockPdfPages = [
        { num: 1, text: 'A'.repeat(5000) },
        { num: 2, text: 'B'.repeat(5000) },
        { num: 3, text: 'C'.repeat(5000) },
      ];
      const fakePdf = Buffer.from('fake-pdf-content');
      const result = await extractAttachmentText('application/pdf', fakePdf.toString('base64'));
      expect(result!.length).toBeLessThanOrEqual(8000);
      expect(result).toContain('[Página 1]');
      expect(result).toContain('[Página 2]');
    });
  });

  describe('unknown mime type', () => {
    it('returns null for application/vnd.ms-excel', async () => {
      const result = await extractAttachmentText('application/vnd.ms-excel', toBase64('data'));
      expect(result).toBeNull();
    });

    it('returns null for image/png', async () => {
      const result = await extractAttachmentText('image/png', toBase64('data'));
      expect(result).toBeNull();
    });
  });
});
