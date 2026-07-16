import { config } from '../../config/index.js';
import { isModelMultimodal } from '../../config/models.js';

export interface ResolvedModel {
  model: string;
  label: string;
  multimodal: boolean;
  contextLength?: number;
}

export class ChatModelRouter {
  resolve(modelId?: string): ResolvedModel {
    const model = modelId || config.models.chat;
    return {
      model,
      label: model.split('/').pop() || model,
      multimodal: isModelMultimodal(model),
      contextLength: 128000,
    };
  }

  validateMultimodal(resolved: ResolvedModel, attachments?: Array<{ type: string }>): void {
    if (attachments && attachments.length > 0 && !resolved.multimodal) {
      throw new Error(`El modelo **${resolved.label}** no soporta archivos adjuntos.`);
    }
  }
}
