import { config, modelRegistry, type ModelEntry } from '../../config/index.js';

export interface ResolvedModel {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  label: string;
  multimodal: boolean;
  contextLength?: number;
}

export class ChatModelRouter {
  resolve(modelId?: string): ResolvedModel {
    const entry = modelId && modelRegistry[modelId] ? modelRegistry[modelId] : null;
    return {
      model: entry?.model || config.models.chat,
      apiKey: entry?.apiKey,
      baseUrl: entry?.baseUrl,
      label: entry?.label || entry?.model || config.models.chat,
      multimodal: !!entry?.multimodal,
      contextLength: entry?.contextLength,
    };
  }

  validateMultimodal(resolved: ResolvedModel, attachments?: Array<{ type: string }>): void {
    if (attachments && attachments.length > 0 && !resolved.multimodal) {
      throw new Error(`El modelo **${resolved.label}** no soporta archivos adjuntos.`);
    }
  }
}
