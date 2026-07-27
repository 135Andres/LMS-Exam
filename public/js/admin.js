const $ = (s) => document.querySelector(s);
const content = $('#content');
const breadcrumb = $('#breadcrumb');

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = 'login.html'; return null; }
  if (res.status === 403) { content.innerHTML = '<div class="empty-state">Acceso denegado — se requiere rol admin.</div>'; return null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function setBreadcrumb(items) {
  breadcrumb.innerHTML = items.map((item, i) => {
    if (i < items.length - 1) return `<a id="bc-${i}">${esc(item)}</a><span class="sep">/</span>`;
    return `<span>${esc(item)}</span>`;
  }).join('');
}

/* ── User List ── */
async function showUserList() {
  content.innerHTML = '<div id="loading">Cargando usuarios...</div>';
  setBreadcrumb(['Usuarios']);
  const data = await api('/api/admin/users');
  if (!data) return;

  if (!data.users.length) {
    content.innerHTML = '<div class="empty-state">No hay usuarios registrados.</div>';
    return;
  }

  let html = `<div class="card"><h2>Usuarios (${data.users.length})</h2><table>
    <thead><tr><th>Email</th><th>Rol</th><th>Exámenes</th><th>Costo API</th><th>Creado</th></tr></thead>
    <tbody>`;

  for (const u of data.users) {
    const roleBadge = u.role === 'admin' ? '<span class="badge badge-admin">admin</span>' : '<span class="badge badge-user">user</span>';
    const created = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
    html += `<tr>
      <td><a class="clickable" data-user-id="${esc(u.id)}" data-user-email="${esc(u.email)}">${esc(u.email)}</a></td>
      <td>${roleBadge}</td>
      <td>${u.exams_generated ?? 0}</td>
      <td>${u.total_api_cost != null ? `$${u.total_api_cost.toFixed(4)}` : '—'}</td>
      <td>${created}</td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  content.innerHTML = html;

  content.querySelectorAll('[data-user-id]').forEach(el => {
    el.addEventListener('click', () => showUserDetail(el.dataset.userId, el.dataset.userEmail));
  });
}

/* ── User Detail ── */
async function showUserDetail(userId, email) {
  content.innerHTML = '<div id="loading">Cargando datos del usuario...</div>';
  setBreadcrumb(['Usuarios', email]);

  const [profileData, sessionsData] = await Promise.all([
    api(`/api/admin/users/${userId}/profile`),
    api(`/api/admin/users/${userId}/sessions`),
  ]);
  if (!profileData && !sessionsData) return;

  let html = '';

  /* Profile card */
  const p = profileData?.profile;
  if (p) {
    html += `<div class="card"><h2>Perfil</h2><div class="stats-grid">
      <div class="stat-box"><div class="label">Nombre</div><div class="value">${esc(p.displayName || '—')}</div></div>
      <div class="stat-box"><div class="label">Nivel</div><div class="value">${esc(p.level || '—')}</div></div>
      <div class="stat-box"><div class="label">Carrera / Campo</div><div class="value">${esc(p.field || '—')}</div></div>
      <div class="stat-box"><div class="label">Objetivo</div><div class="value">${esc(p.goal || '—')}</div></div>
      <div class="stat-box"><div class="label">Profundidad</div><div class="value">${esc(p.depth)}</div></div>
      <div class="stat-box"><div class="label">Registro</div><div class="value">${esc(p.register)}</div></div>
      <div class="stat-box"><div class="label">Materias</div><div class="value">${esc((p.subjects || []).join(', ') || '—')}</div></div>
      <div class="stat-box"><div class="label">Métodos</div><div class="value">${esc((p.studyMethods || []).join(', ') || '—')}</div></div>
      <div class="stat-box"><div class="label">Versión</div><div class="value">${p.version}</div></div>
    </div>`;
    if (p.profileLine) {
      html += `<div style="margin-top:.5rem;font-size:.78rem;color:var(--text-tertiary)"><strong>profile_line:</strong> <code style="font-size:.75rem">${esc(p.profileLine)}</code></div>`;
    }
    html += '</div>';
  } else {
    html += '<div class="card"><h2>Perfil</h2><div class="empty-state">Este usuario no tiene perfil configurado.</div></div>';
  }

  /* Sessions card */
  const active = sessionsData?.active || [];
  const archived = sessionsData?.archived || [];
  const total = active.length + archived.length;
  html += `<div class="card"><h2>Sesiones (${total})</h2>`;
  if (total === 0) {
    html += '<div class="empty-state">No hay sesiones para este usuario.</div>';
  } else {
    html += '<div class="tabs"><div class="tab active" data-tab="active">Activas (' + active.length + ')</div><div class="tab" data-tab="archived">Archivadas (' + archived.length + ')</div></div>';
    html += `<div id="tab-active"><table><thead><tr><th>Título</th><th>Msgs</th><th>Preview</th><th>Último msg</th></tr></thead><tbody>`;
    for (const s of active) {
      const preview = s.preview ? esc(s.preview.slice(0, 80)) : '—';
      const title = s.title ? esc(s.title) : '<em style="color:var(--text-tertiary)">Sin título</em>';
      const date = new Date(s.updated_at).toLocaleString();
      html += `<tr>
        <td><a class="clickable" data-session-id="${esc(s.session_id)}">${title}</a></td>
        <td>${s.message_count}</td>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</td>
        <td style="white-space:nowrap">${date}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
    html += `<div id="tab-archived" class="hidden"><table><thead><tr><th>Título</th><th>Msgs</th><th>Preview</th><th>Último msg</th></tr></thead><tbody>`;
    for (const s of archived) {
      const preview = s.preview ? esc(s.preview.slice(0, 80)) : '—';
      const title = s.title ? esc(s.title) : '<em style="color:var(--text-tertiary)">Sin título</em>';
      const date = new Date(s.updated_at).toLocaleString();
      html += `<tr>
        <td><a class="clickable" data-session-id="${esc(s.session_id)}">${title}</a></td>
        <td>${s.message_count}</td>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</td>
        <td style="white-space:nowrap">${date}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';
  content.innerHTML = html;

  /* Wire tabs */
  content.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      content.querySelector('#tab-active').classList.toggle('hidden', name !== 'active');
      content.querySelector('#tab-archived').classList.toggle('hidden', name !== 'archived');
    });
  });

  /* Wire session links */
  content.querySelectorAll('[data-session-id]').forEach(el => {
    el.addEventListener('click', () => showSessionDetail(el.dataset.sessionId, email));
  });

  /* Wire breadcrumb back */
  $('#bc-0')?.addEventListener('click', showUserList);
}

/* ── Session Detail ── */
async function showSessionDetail(sessionId, userEmail) {
  content.innerHTML = '<div id="loading">Cargando detalle de sesión...</div>';
  setBreadcrumb(['Usuarios', userEmail, sessionId.slice(0, 8) + '…']);

  const data = await api(`/api/admin/sessions/${sessionId}/detail`);
  if (!data) return;

  let html = `<a class="back-link" id="backUser">← Volver</a>`;

  /* Tabs: messages, narrative, blocks, raw index */
  html += '<div class="tabs">';
  html += `<div class="tab active" data-tab="messages">Mensajes (${data.messages.length})</div>`;
  html += `<div class="tab" data-tab="narrative">Narrativa</div>`;
  html += `<div class="tab" data-tab="blocks">Bloques (${data.blocks.length})</div>`;
  html += `<div class="tab" data-tab="index">Index JSON</div>`;
  html += '</div>';

  /* Messages */
  html += '<div id="tab-messages" class="msg-list">';
  if (data.messages.length === 0) {
    html += '<div class="empty-state">No hay mensajes en esta sesión.</div>';
  } else {
    for (const m of data.messages) {
      const roleClass = m.role === 'user' ? 'msg-user' : m.role === 'assistant' ? 'msg-assistant' : 'msg-system';
      const model = m.model ? ` · ${esc(m.model)}` : '';
      const time = m.created_at ? new Date(m.created_at).toLocaleString() : '';
      html += `<div class="msg ${roleClass}">
        <div class="msg-meta">${esc(m.role)}${model} · ${time}</div>
        <div class="msg-content">${esc(m.content)}</div>
      </div>`;
    }
  }
  html += '</div>';

  /* Narrative */
  html += '<div id="tab-narrative" class="hidden">';
  if (data.narrative) {
    html += `<div class="narrative-box">${esc(data.narrative)}</div>`;
  } else {
    html += '<div class="empty-state">No hay narrativa (narrative.md) para esta sesión.</div>';
  }
  html += '</div>';

  /* Blocks */
  html += '<div id="tab-blocks" class="hidden">';
  if (data.blocks.length === 0) {
    html += '<div class="empty-state">No hay bloques de conocimiento extraídos.</div>';
  } else {
    for (const b of data.blocks) {
      html += `<div class="block-card">
        <h3>${esc(b.title)}</h3>
        <div class="meta">${esc(b.subject)} · ${esc(b.confidence)} · ${esc(b.extractedAt)}</div>
        <pre>${esc(b.content)}</pre>
      </div>`;
    }
  }
  html += '</div>';

  /* Raw index */
  html += '<div id="tab-index" class="hidden">';
  html += `<div class="json-pre">${esc(JSON.stringify(data.index, null, 2))}</div>`;
  html += '</div>';

  content.innerHTML = html;

  /* Wire tabs */
  content.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      ['messages', 'narrative', 'blocks', 'index'].forEach(id => {
        const el = content.querySelector(`#tab-${id}`);
        if (el) el.classList.toggle('hidden', id !== name);
      });
    });
  });

  /* Wire back link — re-fetch user detail */
  const userId = data.messages[0]?.user_id;
  const emailParts = userEmail;
  content.querySelector('#backUser')?.addEventListener('click', () => {
    if (userId) showUserDetail(userId, emailParts);
    else showUserList();
  });
}

/* ── Init ── */
showUserList();
