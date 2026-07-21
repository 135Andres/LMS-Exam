import { config } from '../../config/index.js';
import { isModelMultimodal, getModelLabel } from '../../config/models.js';

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

  // isExplicitModel: true solo si el usuario eligió este modelo a mano desde
  // el selector (modelId vino en la request) — si vino de la delegación
  // automática del orquestador bajo "Inkling" por default, nunca se nombra el
  // modelo real delegado (ver FIX 3, consolidado post-planes 01-06).
  validateMultimodal(resolved: ResolvedModel, attachments: Array<{ type: string }> | undefined, isExplicitModel: boolean): void {
    if (attachments && attachments.length > 0 && !resolved.multimodal) {
      const label = isExplicitModel ? getModelLabel(resolved.model) : 'Inkling';
      throw new Error(`El modelo **${label}** no soporta archivos adjuntos.`);
    }
  }
}
