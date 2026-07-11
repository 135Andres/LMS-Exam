import { config } from '../../config/index.js';

export interface ResolvedModel {
  model: string;
  label: string;
  multimodal: boolean;
  contextLength?: number;
}

const MULTIMODAL_HINTS = ['nemotron', 'gemma', 'multimodal', 'nano'];

export class ChatModelRouter {
  resolve(modelId?: string): ResolvedModel {
    const model = modelId || config.models.chat;
    return {
      model,
      label: model.split('/').pop() || model,
      multimodal: MULTIMODAL_HINTS.some(h => model.toLowerCase().includes(h)),
      contextLength: 128000,
    };
  }

  validateMultimodal(resolved: ResolvedModel, attachments?: Array<{ type: string }>): void {
    if (attachments && attachments.length > 0 && !resolved.multimodal) {
      throw new Error(`El modelo **${resolved.label}** no soporta archivos adjuntos.`);
    }
  }
}
