import { SYSTEM_PROMPT_TUTOR, SYSTEM_PROMPT_TUTOR_ADMIN_OVERRIDE, SYSTEM_PROMPT_QUIZ_EXPLAIN } from '../../prompts/system.js';
import { ProfileService } from '../profile.service.js';
import { UserModel } from '../../models/user.model.js';
import { SessionSummaryService } from '../session-summary.service.js';
import { ImportedMemoryService } from '../imported-memory.service.js';
import { ChatQuizModeService } from './chat.quiz-mode.service.js';

// ponytail: presupuesto simple por caracteres, prioriza recencia — no hay
// ranking por relevancia; si hace falta afinar, Fase 3 con la UI real.
const MAX_BLOCKS_CONTEXT_CHARS = 6000;

export interface Attachment {
  type: 'image' | 'audio' | 'file';
  mime: string;
  data: string;
}

export class ChatPromptService {
  buildSystemPrompt(modelLabel: string, ragContext: string, userId: string, regenerateInstruction?: string, sessionId?: string, crossChatContext?: string): string {
    const basePrompt = sessionId && ChatQuizModeService.isActive(sessionId)
      ? SYSTEM_PROMPT_QUIZ_EXPLAIN
      : SYSTEM_PROMPT_TUTOR;
    let prompt = basePrompt.replace(/\{MODEL_NAME\}/g, modelLabel);

    if (sessionId) {
      const summary = SessionSummaryService.getNarrative(sessionId);
      if (summary) {
        prompt += `\n\n--- Resumen de la conversación previa ---\n${summary}\n---`;
      }

      const blocks = SessionSummaryService.getBlocks(sessionId);
      if (blocks.length > 0) {
        const sorted = [...blocks].sort((a, b) => b.extractedAt.localeCompare(a.extractedAt));
        const included: string[] = [];
        let usedChars = 0;
        for (const block of sorted) {
          const text = `### ${block.title}\n${block.content}`;
          if (usedChars + text.length > MAX_BLOCKS_CONTEXT_CHARS) break;
          included.push(text);
          usedChars += text.length;
        }
        if (included.length > 0) {
          prompt += `\n\n--- Contenido técnico ya extraído de esta sesión ---\n${included.join('\n\n')}\n---`;
        }
      }
    }

    const user = UserModel.findById(userId);
    if (user?.username) {
      prompt += `\n\n--- Nombre del estudiante ---\nEl estudiante se llama "${user.username}". Dirígete a él/ella por ese nombre de forma natural en la conversación.\n---`;
    }
    if (user?.role === 'admin') {
      prompt += SYSTEM_PROMPT_TUTOR_ADMIN_OVERRIDE;
    }

    const profile = ProfileService.getProfile(userId);
    if (profile) {
      prompt += `\n\n--- Preferencias del estudiante (obligatorias, tienen prioridad sobre el tono por defecto) ---\n${profile}\n---`;
    }

    const importedMemory = ImportedMemoryService.getMemory(userId);
    if (importedMemory) {
      prompt += `\n\n--- Memoria importada de otro proveedor de IA (contexto de conversaciones previas en otra plataforma) ---\n${importedMemory}\n---`;
    }

    if (regenerateInstruction !== undefined) {
      const custom = regenerateInstruction.trim();
      prompt += `\n\n--- Nota de regeneración ---\nEsta es una SEGUNDA explicación del mismo tema para este estudiante — ya recibió una respuesta y pidió que se la expliques diferente.${
        custom ? ` Pidió específicamente: "${custom}" — sigue esa indicación al explicar.` : ' Cambia el enfoque (otra analogía, otro orden, otro tipo de ejemplo). No repitas la explicación anterior con las mismas palabras.'
      }\n---`;
    }

    if (ragContext) {
      prompt += ragContext;
    }

    if (crossChatContext) {
      prompt += crossChatContext;
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
