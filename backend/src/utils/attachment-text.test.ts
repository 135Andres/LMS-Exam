import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockPdfText = '';
let mockPdfShouldThrow = false;

const mockGetText = () => {
  if (mockPdfShouldThrow) return Promise.reject(new Error('corrupted'));
  return Promise.resolve({ text: mockPdfText });
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
