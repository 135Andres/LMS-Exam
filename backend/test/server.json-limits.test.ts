// server.ts arranca listeners, workers y la conexión real a DB en cuanto se
// importa, así que no se puede requerir directamente en un test unitario.
// Este test reconstruye exactamente la misma cadena de middlewares de
// límites de JSON que server.ts (plan 05) para verificar el comportamiento
// real de Express/body-parser: si este archivo cambia, mantener sincronizado
// con la config de límites en server.ts.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

function buildApp() {
  const app = express();

  // app.post (no app.use): el match debe ser exacto, no por prefijo — de lo
  // contrario también capturaría /api/chat/tutor/summary, /quiz/resolve, etc.
  const attachmentJsonLimit = express.json({ limit: '20mb' });
  app.post(['/api/chat/tutor', '/api/chat/tutor/stream'], attachmentJsonLimit);

  app.use(express.json({ limit: '1mb' }));

  app.post('/api/chat/tutor', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
  app.post('/api/chat/tutor/stream', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
  app.post('/api/chat/tutor/summary', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
  app.post('/api/other', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));

  // Express 4 no captura errores async de body-parser automáticamente en
  // todos los casos, pero el error de "entity too large" es síncrono al
  // parsear, así que este handler alcanza para exponer el 413 al test.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  return app;
}

function payloadOfSize(bytes: number) {
  // JSON.stringify overhead: {"data":"...."} — restar el overhead fijo para
  // apuntar a un tamaño total de body cercano al deseado.
  const overhead = 10;
  return { data: 'x'.repeat(Math.max(0, bytes - overhead)) };
}

describe('límites de payload JSON por ruta (plan 05)', () => {
  it('rutas normales aceptan payloads chicos (bien por debajo de 1mb)', async () => {
    const res = await request(buildApp())
      .post('/api/other')
      .send(payloadOfSize(10_000));
    expect(res.status).toBe(200);
  });

  it('rutas normales rechazan payloads que exceden 1mb con 413', async () => {
    const res = await request(buildApp())
      .post('/api/other')
      .send(payloadOfSize(2 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it('/api/chat/tutor acepta un adjunto grande (~5mb) que rutas normales rechazarían', async () => {
    const res = await request(buildApp())
      .post('/api/chat/tutor')
      .send(payloadOfSize(5 * 1024 * 1024));
    expect(res.status).toBe(200);
  });

  it('/api/chat/tutor/stream también acepta payloads grandes (~5mb)', async () => {
    const res = await request(buildApp())
      .post('/api/chat/tutor/stream')
      .send(payloadOfSize(5 * 1024 * 1024));
    expect(res.status).toBe(200);
  });

  it('/api/chat/tutor sigue teniendo un tope: rechaza payloads por encima de 20mb', async () => {
    const res = await request(buildApp())
      .post('/api/chat/tutor')
      .send(payloadOfSize(21 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it('una ruta que solo empieza igual pero no es de adjuntos (/api/chat/tutor/summary) NO hereda el límite grande', async () => {
    const res = await request(buildApp())
      .post('/api/chat/tutor/summary')
      .send(payloadOfSize(2 * 1024 * 1024));
    expect(res.status).toBe(413);
  });
});
