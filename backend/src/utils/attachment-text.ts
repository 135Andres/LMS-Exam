import { PDFParse } from 'pdf-parse';

const MAX_ATTACHMENT_CHARS = 8000;

export async function extractAttachmentText(mime: string, base64Data: string): Promise<string | null> {
  const buffer = Buffer.from(base64Data, 'base64');

  if (mime === 'application/pdf') {
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      await parser.destroy();

      if (result.pages && result.pages.length > 0) {
        const pagesText = result.pages
          .map(p => `[Página ${p.num}]\n${p.text}`)
          .join('\n\n');
        const trimmed = pagesText.trim();
        if (!trimmed) return null;
        return trimmed.slice(0, MAX_ATTACHMENT_CHARS);
      }

      const text = result.text.trim();
      if (!text) return null;
      return text.slice(0, MAX_ATTACHMENT_CHARS);
    } catch {
      return null;
    }
  }

  if (mime === 'text/plain' || mime === 'application/json') {
    return buffer.toString('utf-8').slice(0, MAX_ATTACHMENT_CHARS);
  }

  return null;
}
