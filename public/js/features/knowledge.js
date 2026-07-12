const API_BASE = '/api/knowledge';

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Error en la petición');
  }
  return res.json();
}

export async function fetchKnowledgeItems(opts = {}) {
  const params = new URLSearchParams();
  if (opts.query) params.set('query', opts.query);
  if (opts.subject) params.set('subject', opts.subject);
  if (opts.limit) params.set('limit', opts.limit);
  if (opts.offset) params.set('offset', opts.offset);
  if (opts.verified_only === false) params.set('verified_only', 'false');
  const data = await api(`/items?${params}`);
  return data.items;
}

export async function fetchKnowledgeItem(id) {
  const data = await api(`/items/${id}`);
  return data;
}

export async function fetchSuggestions() {
  const data = await api('/suggestions');
  return data.suggestions;
}

export async function contributeKnowledge(knowledgeId, tags) {
  return api('/contribute', {
    method: 'POST',
    body: JSON.stringify({ knowledgeId, tags }),
  });
}

export async function discardKnowledge(knowledgeId) {
  return api('/discard', {
    method: 'POST',
    body: JSON.stringify({ knowledgeId }),
  });
}

export async function voteKnowledge(knowledgeId, voteType) {
  return api('/vote', {
    method: 'POST',
    body: JSON.stringify({ knowledgeId, voteType }),
  });
}

export async function fetchLeaderboard(limit = 20) {
  const data = await api(`/leaderboard?limit=${limit}`);
  return data.leaders;
}

export async function fetchUserStats() {
  const data = await api('/stats');
  return data.stats;
}

export async function fetchNotifications() {
  const data = await api('/notifications');
  return data.notifications;
}

export async function markNotificationsRead() {
  return api('/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ all: true }),
  });
}

export async function verifyKnowledge(id) {
  return api(`/admin/${id}/verify`, { method: 'POST' });
}

export async function rejectKnowledge(id, reason) {
  return api(`/admin/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function fetchPendingReview() {
  const data = await api('/admin/pending');
  return data.items;
}

export async function deleteKnowledge(id) {
  return api(`/admin/${id}`, { method: 'DELETE' });
}
