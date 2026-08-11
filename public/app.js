const API = '';
let searchTimeout = null;
let activeTag = null;
let totalBookmarks = 0;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getApiKey() {
  return localStorage.getItem('recall_api_key') || '';
}

function authHeaders() {
  const key = getApiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-API-Key'] = key;
  return headers;
}

function requireApiKey() {
  if (getApiKey()) return true;
  toast('Set your API key in Settings first');
  togglePanel('settings-panel');
  $('#settings-key').value = '';
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  loadBookmarks();
  loadTags();

  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => search(e.target.value), 250);
  });

  $('#btn-add').addEventListener('click', () => {
    if (!requireApiKey()) return;
    togglePanel('add-panel');
  });
  $('#btn-import').addEventListener('click', () => {
    if (!requireApiKey()) return;
    togglePanel('import-panel');
  });
  $('#btn-settings').addEventListener('click', () => {
    togglePanel('settings-panel');
    $('#settings-key').value = getApiKey();
  });
  $('#btn-tags-toggle').addEventListener('click', () => {
    const bar = $('#tags-bar');
    const btn = $('#btn-tags-toggle');
    if (bar.style.display === 'none') {
      bar.style.display = '';
      btn.classList.add('active-toggle');
    } else {
      bar.style.display = 'none';
      btn.classList.remove('active-toggle');
    }
  });
  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    localStorage.setItem('recall_api_key', $('#settings-key').value.trim());
    toast('API key saved');
    $('#settings-panel').classList.remove('active');
  });

  $('#add-url').addEventListener('blur', onUrlBlur);
  $('#add-form').addEventListener('submit', onAddSubmit);

  const importZone = $('#import-zone');
  importZone.addEventListener('click', () => $('#import-file').click());
  importZone.addEventListener('dragover', (e) => { e.preventDefault(); importZone.style.borderColor = 'var(--accent)'; });
  importZone.addEventListener('dragleave', () => { importZone.style.borderColor = 'var(--border)'; });
  importZone.addEventListener('drop', onImportDrop);
  $('#import-file').addEventListener('change', onImportFile);
});

function readHeaders() {
  const key = getApiKey();
  if (!key) return {};
  return { 'X-API-Key': key };
}

async function loadBookmarks() {
  const resp = await fetch(`${API}/api/bookmarks`, { headers: readHeaders() });
  const data = await resp.json();
  totalBookmarks = data.total;
  $('#stat-total').textContent = `${totalBookmarks} bookmarks`;
  renderResults(data.results);
}

async function loadTags() {
  const resp = await fetch(`${API}/api/tags`, { headers: readHeaders() });
  const data = await resp.json();
  renderTagsBar(data.tags);
}

async function search(query) {
  const q = query.trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (activeTag) params.set('tag', activeTag);

  if (!q && !activeTag) {
    loadBookmarks();
    return;
  }

  const resp = await fetch(`${API}/api/search?${params}`, { headers: readHeaders() });
  const data = await resp.json();
  renderResults(data.results);
}

function renderResults(results) {
  const list = $('#results');
  if (!results || results.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>No bookmarks found</p>
        <p>Try a different search or add your first bookmark</p>
      </div>`;
    return;
  }

  list.innerHTML = results.map((r) => {
    const title = r.title_hl || r.title || r.url;
    const desc = r.desc_hl || r.description || '';
    const tags = r.tags ? r.tags.split(',').filter(Boolean) : [];
    const date = r.created_at ? new Date(r.created_at + 'Z').toLocaleDateString() : '';
    const truncUrl = r.url.length > 60 ? r.url.substring(0, 60) + '...' : r.url;
    const secretBadge = r.secret ? '<span class="tag secret-tag">secret</span> ' : '';

    return `
      <li class="result-item${r.secret ? ' secret' : ''}" data-id="${r.id}">
        <div class="result-title">${secretBadge}<a href="${escHtml(r.url)}" target="_blank" rel="noopener">${title}</a></div>
        <div class="result-url">${escHtml(truncUrl)}</div>
        ${desc ? `<div class="result-desc">${desc}</div>` : ''}
        <div class="result-footer">
          <div class="result-tags">
            ${tags.map((t) => `<span class="tag${activeTag === t.trim() ? ' active' : ''}" onclick="filterByTag('${escAttr(t.trim())}')">${escHtml(t.trim())}</span>`).join('')}
          </div>
          <div>
            <span class="result-date">${date}</span>
            <button class="btn-danger" onclick="deleteBookmark(${r.id})">remove</button>
          </div>
        </div>
      </li>`;
  }).join('');
}

function renderTagsBar(tags) {
  const bar = $('#tags-bar');
  if (!tags || tags.length === 0) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = tags.map((t) =>
    `<span class="tag${activeTag === t.name ? ' active' : ''}" onclick="filterByTag('${escAttr(t.name)}')">${escHtml(t.name)} (${t.count})</span>`
  ).join('');
}

window.filterByTag = function (tag) {
  if (activeTag === tag) {
    activeTag = null;
  } else {
    activeTag = tag;
  }
  search($('#search-input').value);
  loadTags();
};

function togglePanel(id) {
  const panel = $(`#${id}`);
  const isActive = panel.classList.contains('active');
  $$('.panel').forEach((p) => p.classList.remove('active'));
  if (!isActive) panel.classList.add('active');
}

async function onUrlBlur() {
  const url = $('#add-url').value.trim();
  if (!url) return;

  const indicator = $('#meta-loading');
  indicator.textContent = 'Fetching page info...';
  indicator.style.display = 'block';

  try {
    const resp = await fetch(`${API}/api/fetch-meta`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url }),
    });
    const meta = await resp.json();
    if (meta.title && !$('#add-title').value) {
      $('#add-title').value = meta.title;
    }
    if (meta.description && !$('#add-desc').value) {
      $('#add-desc').value = meta.description;
    }
    indicator.textContent = 'Done';
  } catch {
    indicator.textContent = 'Could not fetch — enter manually';
  }

  setTimeout(() => { indicator.style.display = 'none'; }, 2000);
}

async function onAddSubmit(e) {
  e.preventDefault();
  const url = $('#add-url').value.trim();
  if (!url) return;

  const body = {
    url,
    title: $('#add-title').value.trim(),
    description: $('#add-desc').value.trim(),
    tags: $('#add-tags').value.trim(),
    secret: $('#add-secret').checked,
  };

  const resp = await fetch(`${API}/api/bookmarks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (resp.status === 409) {
    toast('Bookmark already exists');
    return;
  }

  if (resp.ok) {
    toast('Bookmark saved');
    $('#add-form').reset();
    $('#add-panel').classList.remove('active');
    loadBookmarks();
    loadTags();
  } else {
    toast('Failed to save');
  }
}

window.deleteBookmark = async function (id) {
  if (!requireApiKey()) return;
  if (!confirm('Remove this bookmark?')) return;

  const resp = await fetch(`${API}/api/bookmarks/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (resp.ok) {
    toast('Bookmark removed');
    loadBookmarks();
    loadTags();
  }
};

function onImportDrop(e) {
  e.preventDefault();
  $('#import-zone').style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (file) importFile(file);
}

function onImportFile(e) {
  const file = e.target.files[0];
  if (file) importFile(file);
}

async function importFile(file) {
  const result = $('#import-result');
  result.textContent = 'Importing...';
  result.className = 'import-result';

  const html = await file.text();

  const resp = await fetch(`${API}/api/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ html }),
  });

  if (resp.ok) {
    const data = await resp.json();
    result.textContent = `Imported ${data.imported} bookmarks (${data.skipped} skipped)`;
    result.className = 'import-result success';
    loadBookmarks();
    loadTags();
  } else {
    result.textContent = 'Import failed';
    result.className = 'import-result error';
  }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
