# KNOWLEDGE BASE #4: Gamificación y Moderación

## OBJETIVO ESPECÍFICO
Sistema de puntos, badges, leaderboard y cola de moderación para calidad de Knowledge Base.

## SISTEMA DE PUNTOS

### Acciones y Recompensas
| Acción | Puntos | Condiciones | Badge Desbloqueable |
|--------|--------|-------------|---------------------|
| Crear contribución publicada | +10 | status = 'published' | 🌱 **Semilla** (1ª contribución) |
| Contribución verificada por admin | +50 | admin marca `is_verified = 1` | ✅ **Verificador** (5 verificadas) |
| Recibir upvote en tu contenido | +2 | Por upvote (máx +20/día) | ⭐ **Estrella** (10 upvotes totales) |
| Contribución alcanza 10 upvotes | +20 | Net score ≥ 10 | 💎 **Diamante** (5 contribuciones ≥ 10) |
| Contribución alcanza 100 vistas | +15 | view_count ≥ 100 | 👁️ **Faro** (3 contribuciones ≥ 100 vistas) |
| Reportar contenido inválido (confirmado) | +5 | Admin confirma y elimina | 🛡️ **Guardián** (10 reportes válidos) |
| Editar y mejorar contribución ajena | +8 | Cambio > 30% contenido, autor original acepta | ✏️ **Editor** (5 ediciones aceptadas) |
| Completar onboarding KB | +5 | Primera vez que ve tutorial contribución | 🎓 **Alumno** |

### Niveles (Level System)
```
Nivel 1: 0-49 pts      🌱 Novato
Nivel 2: 50-149 pts    🌿 Explorador  
Nivel 3: 150-349 pts   🌳 Contribuidor
Nivel 4: 350-699 pts   🌲 Experto
Nivel 5: 700-1299 pts  🏆 Maestro
Nivel 6: 1300-2499 pts 👑 Sabio
Nivel 7: 2500+ pts     🌟 Leyenda
```

### Tabla: user_kb_stats (Materialized View / Cache)
```sql
CREATE TABLE user_kb_stats (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  total_points INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  contributions_count INTEGER DEFAULT 0,
  verified_count INTEGER DEFAULT 0,
  total_upvotes_received INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  reports_valid INTEGER DEFAULT 0,
  edits_accepted INTEGER DEFAULT 0,
  badges TEXT DEFAULT '[]',  -- JSON array de badge IDs
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Trigger para actualizar stats
CREATE TRIGGER update_user_kb_stats
AFTER INSERT ON knowledge_contributions
BEGIN
  UPDATE user_kb_stats SET
    total_points = total_points + NEW.points,
    contributions_count = contributions_count + (CASE WHEN NEW.contribution_type = 'created' THEN 1 ELSE 0 END),
    verified_count = verified_count + (CASE WHEN NEW.contribution_type = 'verified' THEN 1 ELSE 0 END),
    level = CASE 
      WHEN total_points + NEW.points >= 2500 THEN 7
      WHEN total_points + NEW.points >= 1300 THEN 6
      WHEN total_points + NEW.points >= 700 THEN 5
      WHEN total_points + NEW.points >= 350 THEN 4
      WHEN total_points + NEW.points >= 150 THEN 3
      WHEN total_points + NEW.points >= 50 THEN 2
      ELSE 1
    END
  WHERE user_id = NEW.user_id;
END;
```

## BADGES (Definición)

```typescript
// backend/src/config/badges.ts
export const KB_BADGES = [
  { id: 'seed', name: 'Semilla', emoji: '🌱', description: 'Primera contribución publicada', points: 0, tier: 'bronze' },
  { id: 'verifier', name: 'Verificador', emoji: '✅', description: '5 contribuciones verificadas por admins', points: 0, tier: 'silver' },
  { id: 'star', name: 'Estrella', emoji: '⭐', description: '10 upvotes totales en tus contribuciones', points: 0, tier: 'silver' },
  { id: 'diamond', name: 'Diamante', emoji: '💎', description: '5 contribuciones con 10+ upvotes cada una', points: 0, tier: 'gold' },
  { id: 'lighthouse', name: 'Faro', emoji: '👁️', description: '3 contribuciones con 100+ vistas', points: 0, tier: 'gold' },
  { id: 'guardian', name: 'Guardián', emoji: '🛡️', description: '10 reportes válidos de contenido malo', points: 0, tier: 'silver' },
  { id: 'editor', name: 'Editor', emoji: '✏️', description: '5 ediciones aceptadas por autores', points: 0, tier: 'bronze' },
  { id: 'scholar', name: 'Erudito', emoji: '🎓', description: 'Completó tutorial de contribución', points: 0, tier: 'bronze' },
  { id: 'prolific', name: 'Prolífico', emoji: '📚', description: '50 contribuciones publicadas', points: 0, tier: 'platinum' },
  { id: 'legend', name: 'Leyenda', emoji: '🌟', description: 'Nivel 7 alcanzado (2500+ pts)', points: 0, tier: 'diamond' },
] as const;

export type BadgeId = typeof KB_BADGES[number]['id'];
```

## LEADERBOARD

```typescript
// GET /api/knowledge/leaderboard?period=week|month|all&limit=20
router.get('/leaderboard', authenticate, async (req, res) => {
  const { period = 'all', limit = 20 } = req.query;
  
  let dateFilter = '';
  if (period === 'week') dateFilter = "AND kc.created_at > datetime('now', '-7 days')";
  if (period === 'month') dateFilter = "AND kc.created_at > datetime('now', '-30 days')";
  
  const leaders = db.prepare(`
    SELECT 
      u.id, u.username, u.email,
      uks.total_points, uks.level, uks.contributions_count,
      uks.verified_count, uks.badges
    FROM user_kb_stats uks
    JOIN users u ON u.id = uks.user_id
    WHERE uks.total_points > 0
    ORDER BY uks.total_points DESC
    LIMIT ?
  `).all(limit);
  
  res.json({ 
    period, 
    leaders: leaders.map((l, i) => ({ 
      rank: i + 1, 
      ...l, 
      badges: JSON.parse(l.badges) 
    })) 
  });
});
```

## MODERACIÓN (Admin Panel)

### Cola de Revisión
```sql
-- Vista para admin: contribuciones pendientes
CREATE VIEW v_kb_moderation_queue AS
SELECT 
  kb.id, kb.content, kb.summary, kb.subject, kb.topic,
  kb.source_user_id, u.username as contributor,
  kb.tags, kb.created_at,
  (SELECT COUNT(*) FROM knowledge_votes WHERE knowledge_id = kb.id AND vote_type = 1) as upvotes,
  (SELECT COUNT(*) FROM knowledge_votes WHERE knowledge_id = kb.id AND vote_type = -1) as downvotes,
  kb.status
FROM knowledge_base kb
JOIN users u ON u.id = kb.source_user_id
WHERE kb.status = 'pending_review'
ORDER BY kb.created_at ASC;
```

### Acciones Admin
```typescript
// POST /api/admin/knowledge/:id/action
router.post('/:id/action', authenticate, requireAdmin, validate(actionSchema), async (req, res) => {
  const { action, reason } = req.body; // action: 'verify' | 'reject' | 'edit' | 'feature'
  const kb = KnowledgeModel.getById(req.params.id);
  
  switch (action) {
    case 'verify':
      KnowledgeModel.updateStatus(kb.id, 'published', { is_verified: 1, verified_by: req.user.id });
      await GamificationService.awardPoints(kb.source_user_id, 'knowledge_verified', 50);
      // Notificar usuario
      NotificationService.queue(kb.source_user_id, { type: 'kb_verified', knowledgeId: kb.id });
      break;
      
    case 'reject':
      KnowledgeModel.updateStatus(kb.id, 'rejected');
      NotificationService.queue(kb.source_user_id, { 
        type: 'kb_rejected', 
        knowledgeId: kb.id, 
        reason: reason || 'No cumple estándares de calidad' 
      });
      break;
      
    case 'feature':
      // Destacar en homepage
      KnowledgeModel.update(kb.id, { is_featured: 1 });
      break;
      
    case 'edit':
      // Admin edita directamente
      KnowledgeModel.update(kb.id, req.body.edits);
      break;
  }
  
  res.json({ success: true });
});
```

### Criterios de Calidad (Checklist Admin)
```
✅ CONTENIDO TÉCNICO
  [ ] Información correcta y actualizada
  [ ] Explicación clara y estructurada
  [ ] Ejemplos relevantes y correctos
  [ ] No hay errores conceptuales graves

✅ FORMATO
  [ ] LaTeX renderizado correctamente (KaTeX)
  [ ] Estructura: intro → desarrollo → conclusión
  [ ] Tags apropiados (materia, tema, dificultad)
  [ ] Resumen < 200 chars descriptivo

✅ ORIGINALIDAD
  [ ] No es copia directa de Wikipedia/libros
  [ ] Aporta valor pedagógico (ejemplos, analogías, tips)
  [ ] Si es Q&A: pregunta real de estudiante, respuesta tutor

✅ SEGURIDAD
  [ ] No datos personales (emails, nombres reales)
  [ ] No contenido inapropiado/ofensivo
  [ ] No spam/promoción externa
```

## NOTIFICACIONES USUARIO

```typescript
// Tipos de notificación KB
type KBNotificationType = 
  | 'kb_suggested'      // "Detectamos contenido valioso, ¿guardar?"
  | 'kb_published'      // "Tu contribución fue publicada 🎉 +10 pts"
  | 'kb_verified'       // "¡Verificada por admin! +50 pts ✅"
  | 'kb_rejected'       // "Tu contribución no fue aprobada: [razón]"
  | 'kb_upvoted'        // "Tu aporte recibió un upvote +2 pts"
  | 'kb_featured'       // "Tu contribución destacada en inicio 🌟"
  | 'kb_badge_earned'   // "¡Nueva insignia: 🌱 Semilla!"
  | 'kb_level_up';      // "¡Subiste a Nivel 3: 🌳 Contribuidor!"

// Frontend: Toast + Centro notificaciones (campana)
```

## FRONTEND: Perfil KB
```javascript
// features/knowledge/kb-profile.js
export function renderKBProfile(userStats) {
  return `
    <div class="kb-profile">
      <div class="kb-header">
        <div class="kb-avatar">${getLevelEmoji(userStats.level)}</div>
        <div class="kb-level-info">
          <h3>Nivel ${userStats.level} ${getLevelName(userStats.level)}</h3>
          <div class="kb-xp-bar">
            <div class="kb-xp-fill" style="width: ${xpPercent(userStats)}%"></div>
          </div>
          <span class="kb-xp-text">${userStats.total_points} / ${nextLevelXP(userStats.level)} XP</span>
        </div>
      </div>
      
      <div class="kb-stats-grid">
        <stat-card icon="📝" value="${userStats.contributions_count}" label="Aportes"></stat-card>
        <stat-card icon="✅" value="${userStats.verified_count}" label="Verificados"></stat-card>
        <stat-card icon="⭐" value="${userStats.total_upvotes_received}" label="Upvotes"></stat-card>
        <stat-card icon="👁️" value="${userStats.total_views}" label="Vistas"></stat-card>
      </div>
      
      <div class="kb-badges">
        ${userStats.badges.map(b => `<span class="badge ${b.tier}" title="${b.description}">${b.emoji}</span>`).join('')}
      </div>
    </div>
  `;
}
```

## AGENTE RECOMENDADO
`general` - Backend gamificación + Admin UI + Frontend profile + Notificaciones.