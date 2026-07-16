import { SYSTEM_PROMPT_TUTOR } from '../../prompts/system.js';
import { ProfileService } from '../profile.service.js';

export interface Attachment {
  type: 'image' | 'audio' | 'file';
  mime: string;
  data: string;
}

export class ChatPromptService {
  buildSystemPrompt(modelLabel: string, ragContext: string, userId: string): string {
    let prompt = SYSTEM_PROMPT_TUTOR.replace(/\{MODEL_NAME\}/g, modelLabel);

    const profile = ProfileService.getProfile(userId);
    if (profile) {
      prompt += `\n\n--- Preferencias del estudiante (obligatorias, tienen prioridad — ver directriz 12) ---\n${profile}\n---`;
    }

    if (ragContext) {
      prompt += ragContext;
    }
    return prompt;
  }

  buildContent(message: string, attachments?: Attachment[]): Array<Record<string, unknown>> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: message }];

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.type === 'image') {
          content.push({ type: 'image_url', image_url: { url: `data:${att.mime};base64,${att.data}` } });
        } else if (att.type === 'audio') {
          content.push({ type: 'audio_url', audio_url: { url: `data:${att.mime};base64,${att.data}` } });
        } else if (att.type === 'file') {
          content.push({ type: 'text', text: `\n\n[Archivo adjunto: ${att.mime}, ${att.data.length} chars base64]` });
        }
      }
    }

    return content;
  }
}
