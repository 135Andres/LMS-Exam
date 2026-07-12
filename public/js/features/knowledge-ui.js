const LEVEL_NAMES = ['', 'Novato', 'Explorador', 'Contribuidor', 'Experto', 'Maestro', 'Sabio', 'Leyenda'];
const LEVEL_EMOJIS = ['', '🌱', '🌿', '🌳', '🌲', '🏆', '👑', '🌟'];
const SUBJECT_LABELS = {
  matematicas: 'Matemáticas',
  fisica: 'Física',
  quimica: 'Química',
  biologia: 'Biología',
  historia: 'Historia',
  lenguaje: 'Lenguaje',
  informatica: 'Informática',
  general: 'General',
};

export function renderKnowledgeItem(item, userVote) {
  const netScore = item.upvotes - item.downvotes;
  const verifiedBadge = item.is_verified ? '<span class="kb-badge kb-badge-verified">✓ Verificado</span>' : '';
  const subjectLabel = SUBJECT_LABELS[item.subject] || item.subject;
  const voteUp = userVote === 1 ? 'active' : '';
  const voteDown = userVote === -1 ? 'active' : '';

  return `
    <div class="kb-item" data-id="${item.id}">
      <div class="kb-item-header">
        <span class="kb-subject">${subjectLabel}</span>
        ${item.topic ? `<span class="kb-topic">${item.topic}</span>` : ''}
        ${verifiedBadge}
      </div>
      <div class="kb-item-summary">${escapeHtml(item.summary || item.content.slice(0, 180))}</div>
      <div class="kb-item-footer">
        <div class="kb-votes">
          <button class="kb-vote-btn up ${voteUp}" data-action="upvote" data-id="${item.id}">▲</button>
          <span class="kb-score">${netScore}</span>
          <button class="kb-vote-btn down ${voteDown}" data-action="downvote" data-id="${item.id}">▼</button>
        </div>
        <span class="kb-views">👁 ${item.view_count}</span>
        <span class="kb-date">${formatDate(item.created_at)}</span>
      </div>
    </div>
  `;
}

export function renderKnowledgeList(items, userVotes = {}) {
  if (!items || items.length === 0) {
    return '<div class="kb-empty">No hay contenido en la Knowledge Base todavía.</div>';
  }
  return items.map(item => renderKnowledgeItem(item, userVotes[item.id])).join('');
}

export function renderSuggestionToast(suggestion) {
  return `
    <div class="kb-toast" data-id="${suggestion.id}">
      <div class="kb-toast-icon">💡</div>
      <div class="kb-toast-content">
        <strong>¿Guardar para la comunidad?</strong>
        <span>Detectamos una buena explicación sobre <em>${SUBJECT_LABELS[suggestion.subject] || suggestion.subject}</em></span>
      </div>
      <div class="kb-toast-actions">
        <button class="btn-secondary" data-action="dismiss" data-id="${suggestion.id}">Ahora no</button>
        <button class="btn-primary" data-action="review" data-id="${suggestion.id}">Revisar y guardar</button>
      </div>
    </div>
  `;
}

export function renderStats(stats) {
  const levelName = LEVEL_NAMES[stats.level] || 'Novato';
  const levelEmoji = LEVEL_EMOJIS[stats.level] || '🌱';
  return `
    <div class="kb-profile">
      <div class="kb-profile-header">
        <span class="kb-level-emoji">${levelEmoji}</span>
        <div>
          <h3>Nivel ${stats.level}: ${levelName}</h3>
          <span class="kb-points">${stats.total_points} puntos</span>
        </div>
      </div>
      <div class="kb-stats-grid">
        <div class="kb-stat"><span class="kb-stat-value">${stats.contributions_count}</span><span class="kb-stat-label">Aportes</span></div>
        <div class="kb-stat"><span class="kb-stat-value">${stats.verified_count}</span><span class="kb-stat-label">Verificados</span></div>
        <div class="kb-stat"><span class="kb-stat-value">${stats.total_upvotes_received}</span><span class="kb-stat-label">Upvotes</span></div>
        <div class="kb-stat"><span class="kb-stat-value">${stats.total_views}</span><span class="kb-stat-label">Vistas</span></div>
      </div>
    </div>
  `;
}

export function renderLeaderboard(leaders) {
  if (!leaders || leaders.length === 0) {
    return '<div class="kb-empty">Aún no hay contribuidores en el leaderboard.</div>';
  }
  return leaders.map((l, i) => {
    const emoji = LEVEL_EMOJIS[l.level] || '🌱';
    const name = LEVEL_NAMES[l.level] || 'Novato';
    return `
      <div class="kb-leader ${i < 3 ? 'kb-leader-top' : ''}">
        <span class="kb-rank">#${i + 1}</span>
        <span class="kb-leader-emoji">${emoji}</span>
        <span class="kb-leader-name">${escapeHtml(l.username || 'Anónimo')}</span>
        <span class="kb-leader-level">${name}</span>
        <span class="kb-leader-points">${l.total_points} pts</span>
      </div>
    `;
  }).join('');
}

export function renderAdminPending(items) {
  if (!items || items.length === 0) {
    return '<div class="kb-empty">No hay contenido pendiente de revisión.</div>';
  }
  return items.map(item => `
    <div class="kb-admin-item" data-id="${item.id}">
      <div class="kb-admin-header">
        <span class="kb-subject">${SUBJECT_LABELS[item.subject] || item.subject}</span>
        <span class="kb-status ${item.status}">${item.status}</span>
      </div>
      <div class="kb-admin-summary">${escapeHtml(item.summary || '')}</div>
      <div class="kb-admin-content">${escapeHtml(item.content.slice(0, 300))}...</div>
      <div class="kb-admin-actions">
        <button class="btn-primary" data-action="verify" data-id="${item.id}">✓ Verificar</button>
        <button class="btn-secondary" data-action="reject" data-id="${item.id}">✗ Rechazar</button>
        <button class="btn-danger" data-action="delete" data-id="${item.id}">🗑 Eliminar</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
