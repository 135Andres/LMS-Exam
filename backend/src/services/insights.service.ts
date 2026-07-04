import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/connection.js';
import { generateFromAI } from './ai/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const INSIGHT_PROMPT = `Eres un analizador de progreso académico. Dado un conjunto de mensajes de conversación de tutoría de un estudiante, identifica:

1. FORTALEZAS: temas o habilidades donde el estudiante muestra comprensión
2. DEBILIDADES: temas donde el estudiante tiene dificultades o hace preguntas recurrentes
3. RECOMENDACIONES: qué debería estudiar o practicar a continuación

Responde ÚNICAMENTE con JSON, sin markdown:
{
  "fortalezas": ["fortaleza 1", "fortaleza 2"],
  "debilidades": ["debilidad 1", "debilidad 2"],
  "recomendaciones": "recomendación general de estudio"
}`;

export async function generateDailyInsights(userId: string, date: string): Promise<void> {
  const todayStart = `${date}T00:00:00`;
  const todayEnd = `${date}T23:59:59`;

  const messages = getDb().prepare(
    `SELECT content, role FROM chat_logs
     WHERE user_id = ? AND created_at BETWEEN ? AND ?
     ORDER BY created_at ASC`
  ).all(userId, todayStart, todayEnd) as Array<{ content: string; role: string }>;

  if (messages.length < 3) return; // No hay suficiente data para insights

  const conversationText = messages
    .map(m => `[${m.role === 'user' ? 'Estudiante' : 'Tutor'}]: ${m.content}`)
    .join('\n')
    .slice(0, 3000); // Truncar a 3K chars para no exceder tokens

  try {
    const result = await generateFromAI('nvidia', INSIGHT_PROMPT, conversationText, null, {
      model: config.models.chat,
      temperature: 0.3,
      max_tokens: 500,
    });

    const insights = JSON.parse(result.content) as {
      fortalezas: string[];
      debilidades: string[];
      recomendaciones: string;
    };

    // Insertar en chat_insights (ON CONFLICT DO UPDATE para la clave única)
    const stmt = getDb().prepare(`
      INSERT INTO chat_insights (id, user_id, subject, date, insights)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, subject, date) DO UPDATE SET
        insights = excluded.insights,
        created_at = datetime('now')
    `);

    const subjects = extractSubjects(messages);
    for (const subject of subjects) {
      const insightData = JSON.stringify({
        ...insights,
        generated_at: new Date().toISOString(),
        message_count: messages.length,
      });
      stmt.run(uuidv4(), userId, subject, date, insightData);
    }

    // Si no hay subjects, usar "general"
    if (subjects.length === 0) {
      const insightData = JSON.stringify({
        ...insights,
        generated_at: new Date().toISOString(),
        message_count: messages.length,
      });
      stmt.run(uuidv4(), userId, 'general', date, insightData);
    }

    logger.info('Insights generados', { userId, date, subjects: subjects.length || 1, messages: messages.length });
  } catch (err) {
    logger.warn('Error generando insights', { userId, date, error: (err as Error).message });
  }
}

function extractSubjects(messages: Array<{ content: string; role: string }>): string[] {
  const subjectKeywords: Record<string, string[]> = {
    matematicas: ['álgebra', 'cálculo', 'trigonometría', 'geometría', 'derivada', 'integral', 'matemática', 'números', 'ecuación'],
    fisica: ['física', 'movimiento', 'fuerza', 'energía', 'newton', 'velocidad', 'aceleración'],
    quimica: ['química', 'elemento', 'molécula', 'reacción', 'átomo', 'compuesto'],
    historia: ['historia', 'revolución', 'guerra', 'imperio', 'civilización'],
    lenguaje: ['español', 'literatura', 'gramática', 'ortografía', 'redacción'],
    biologia: ['biología', 'célula', 'genética', 'organismo', 'evolución'],
  };

  const detected = new Set<string>();
  const allText = messages.map(m => m.content.toLowerCase()).join(' ');

  for (const [subject, keywords] of Object.entries(subjectKeywords)) {
    if (keywords.some(kw => allText.includes(kw))) {
      detected.add(subject);
    }
  }

  return Array.from(detected);
}
