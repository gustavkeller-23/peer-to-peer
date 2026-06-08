const EMOJIS = ['🌟','⚽','🏆','🎯','🚀','🦁','🐯','🦊','🐺','🦝',
    '🦅','🦉','🐬','🦈','🐙','🦋','🌺','🍀','🌊','🔥',
    '⚡','🌙','🎭','🎪','🎨','🎵','🎲','🏅'];

let inventoryData = [];
let peersData     = [];

// ── SSE ──────────────────────────────────────────────────────────────────
const evtSource = new EventSource('/events');

evtSource.addEventListener('inventory', e => {
    inventoryData = JSON.parse(e.data);
    renderInventory();
});

evtSource.addEventListener('peers', e => {
    peersData = JSON.parse(e.data);
    renderPeers();
});

evtSource.addEventListener('log', e => {
    const d = JSON.parse(e.data);
    appendLog(d.text, true);
});

evtSource.addEventListener('search_hit', e => {
    const d = JSON.parse(e.data);
    appendLog(`🎯 HIT: ${d.sticker_id} está em ${d.peer_id} (qtd: ${d.available_quantity})`, true);
});

evtSource.addEventListener('search_miss', e => {
    const d = JSON.parse(e.data);
    appendLog(`💨 MISS: ${d.sticker_id} não encontrada`, false);
});

evtSource.onerror = () => {
    document.getElementById('status-dot').style.background = '#ff6b6b';
    document.getElementById('status-dot').style.boxShadow  = '0 0 8px #ff6b6b';
};

// ── Render inventory ─────────────────────────────────────────────────────
function renderInventory() {
    const grid = document.getElementById('inventory-grid');
    if (!inventoryData.length) { fetchInventory(); return; }

    const total   = inventoryData.reduce((s,i) => s + i.quantity, 0);
    const unique  = inventoryData.filter(i => i.quantity > 0).length;
    const missing = inventoryData.filter(i => i.quantity === 0).length;

    document.getElementById('stat-total').textContent   = total;
    document.getElementById('stat-unique').textContent  = unique;
    document.getElementById('stat-missing').textContent = missing;

    grid.innerHTML = inventoryData.map((item, idx) => {
        const mine  = item.sticker_id === 'FIG-12';
        const empty = item.quantity === 0;
        const emoji = EMOJIS[idx] || '🃏';
        return `
        <div class="sticker-card ${mine ? 'mine' : ''} ${empty ? 'empty' : ''}"
             title="${item.sticker_id}${empty ? ' — clique para buscar' : ''}">
          ${item.quantity > 1 ? `<div class="qty-badge">${item.quantity}x</div>` : ''}
          <div class="sticker-id">${item.sticker_id}</div>
          <div class="sticker-img">${emoji}</div>
          <div class="sticker-qty ${empty ? 'zero' : ''}">${item.quantity}</div>
          ${empty ? `<button class="search-btn" onclick="quickSearch('${item.sticker_id}')">buscar</button>` : ''}
        </div>`;
    }).join('');
}

// ── Render peers ─────────────────────────────────────────────────────────
function renderPeers() {
    const list = document.getElementById('peers-list');
    document.getElementById('stat-peers').textContent = peersData.length;

    if (!peersData.length) {
        list.innerHTML = '<div class="no-peers">Nenhum peer conectado</div>';
        return;
    }
    list.innerHTML = peersData.map(p =>
        `<div class="peer-item">${p}</div>`
    ).join('');
}

// ── Log ──────────────────────────────────────────────────────────────────
function appendLog(text, highlight = false) {
    const log = document.getElementById('log-entries');
    const now  = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const el   = document.createElement('div');
    el.className = `log-entry${highlight ? ' new' : ''}`;
    el.innerHTML = `<span class="log-time">${now}</span>${text}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    // remove highlight após 2s
    setTimeout(() => el.classList.remove('new'), 2000);
    // mantém no máximo 100 entradas
    while (log.children.length > 100) log.removeChild(log.firstChild);
}

function clearLog() {
    document.getElementById('log-entries').innerHTML = '';
}

// ── API calls ─────────────────────────────────────────────────────────────
async function fetchInventory() {
    const r = await fetch('/inventory');
    const d = await r.json();
    inventoryData = d.inventory;
    renderInventory();
}

async function connectPeer() {
    const addr = document.getElementById('peer-addr').value.trim();
    if (!addr) return;
    appendLog(`🔌 Conectando a ${addr}...`, true);
    const r = await fetch('/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr })
    });
    const d = await r.json();
    appendLog(d.error ? `❌ ${d.error}` : `✅ ${d.message}`, !d.error);
    document.getElementById('peer-addr').value = '';
}

async function searchSticker() {
    const raw = document.getElementById('manual-sticker').value.trim().toUpperCase();
    const id  = raw.startsWith('FIG-') ? raw : `FIG-${raw.padStart(2,'0')}`;
    await doSearch(id);
    document.getElementById('manual-sticker').value = '';
}

async function quickSearch(stickerId) {
    await doSearch(stickerId);
}

async function doSearch(stickerId) {
    appendLog(`🔍 Buscando ${stickerId}...`, true);
    const r = await fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticker_id: stickerId })
    });
    const d = await r.json();
    if (d.already_have) appendLog(`📦 Você já possui ${stickerId}`, false);
    else if (d.error)   appendLog(`❌ ${d.error}`, false);
}

// ── Enter shortcuts ───────────────────────────────────────────────────────
document.getElementById('manual-sticker').addEventListener('keydown', e => e.key === 'Enter' && searchSticker());
document.getElementById('peer-addr').addEventListener('keydown', e => e.key === 'Enter' && connectPeer());

// ── Init ──────────────────────────────────────────────────────────────────
fetchInventory();
fetch('/peers').then(r => r.json()).then(d => { peersData = d.peers; renderPeers(); });
appendLog('🚀 Interface iniciada', true);