// ═══════════════════════════════════════════════════════════
//  CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════
// O frontend está na porta PORT+2, WS frontend na PORT+1
const FRONTEND_WS_URL = `ws://${location.hostname}:${parseInt(location.port) - 1}`;

// ═══════════════════════════════════════════════════════════
//  ESTADO LOCAL
// ═══════════════════════════════════════════════════════════
let ws = null;
let state = {
    peerId: '…',
    myStickerId: '…',
    inventory: {},
    neighbors: [],
    searchHistory: [],
    tradeHistory: [],
    messages: [],
};
let pendingOffers = {}; // message_id → msg
let searchResults = [];
let messagesLog = [];

// ═══════════════════════════════════════════════════════════
//  WebSocket ao servidor Node
// ═══════════════════════════════════════════════════════════
function connect() {
    ws = new WebSocket(FRONTEND_WS_URL);

    ws.onopen = () => {
        document.getElementById('conn-dot').classList.add('on');
        document.getElementById('conn-label').textContent = 'Conectado';
        ws.send(JSON.stringify({ type: 'GET_STATE' }));
    };

    ws.onclose = () => {
        document.getElementById('conn-dot').classList.remove('on');
        document.getElementById('conn-label').textContent = 'Reconectando…';
        setTimeout(connect, 2000);
    };

    ws.onerror = (e) => { console.warn('WebSocket error:', e); };

    ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        handleServerMessage(msg);
    };
}

connect();

function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

// ═══════════════════════════════════════════════════════════
//  Mensagens do servidor
// ═══════════════════════════════════════════════════════════
function handleServerMessage(msg) {
    switch (msg.type) {
        case 'STATE_UPDATE':         return applyState(msg);
        case 'LOG':                  return appendLog(msg);
        case 'SEARCH_RESULT':        return handleSearchResult(msg);
        case 'TRADE_OFFER_RECEIVED': return handleOfferReceived(msg.msg);
        case 'TRADE_ACCEPTED':       return toast('✅ Troca aceita!', 'success');
        case 'TRADE_REJECTED':       return toast('❌ Troca rejeitada pelo peer', 'error');
        case 'TRADE_REJECTED_BY_ME': return toast('🚫 Troca recusada', 'info');
        case 'TRADE_SENT':           return toast(`📤 Proposta enviada para ${msg.target} (flooding)`, 'info');
        case 'TRANSFER_DONE':        return toast('🎉 Transferência concluída!', 'success');
        case 'ERROR':                return toast('⚠️ ' + msg.msg, 'error');
    }
}

// ═══════════════════════════════════════════════════════════
//  Aplicar estado
// ═══════════════════════════════════════════════════════════
function applyState(s) {
    state = { ...state, ...s };
    document.getElementById('header-peer-id').textContent = state.peerId || '…';
    document.getElementById('header-sticker-id').textContent = state.myStickerId || '…';
    renderNeighbors();
    renderInventory();
    renderTradeTargetOptions();

    if (Array.isArray(s.messages) && s.messages.length > 0) {
        messagesLog = s.messages;
        renderMessages();
    }
}

// ═══════════════════════════════════════════════════════════
//  Renderizações
// ═══════════════════════════════════════════════════════════
function renderNeighbors() {
    const list = document.getElementById('peer-list');
    document.getElementById('neighbor-count').textContent = state.neighbors.length;

    if (!state.neighbors.length) {
        list.innerHTML = '<div class="empty"><div class="icon">📡</div>Sem vizinhos</div>';
        return;
    }

    list.innerHTML = state.neighbors.map(n => `
    <div class="peer-item" onclick="selectNeighbor('${escHtml(n.peer_id)}')">
      <div class="dot ${n.connected ? 'on' : ''}"></div>
      <div class="pid">${escHtml(n.peer_id)}</div>
      <div class="addr">${escHtml(n.account && n.account !== n.peer_id ? n.account + ' · ' : '')}${escHtml(n.ip)}:${n.port}</div>
    </div>
  `).join('');
}

const STICKER_BASE_URL = 'https://rgcoelho01.github.io/album/images/';

function stickerImageUrl(stickerId) {
    const id = stickerId.toUpperCase().replace(/\.PNG$/i, '');
    return `${STICKER_BASE_URL}${id}.PNG`;
}

function renderInventory() {
    const grid = document.getElementById('inv-grid');
    const entries = Object.entries(state.inventory).filter(([, qty]) => qty > 0);

    if (!entries.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="icon">📭</div>Inventário vazio</div>';
        return;
    }

    grid.innerHTML = entries.map(([id, qty]) => {
        const isMine = id === state.myStickerId;
        const imgUrl = stickerImageUrl(id);
        return `
      <div class="sticker-card ${isMine ? 'mine' : ''}" onclick="onStickerClick('${escHtml(id)}')">
        ${isMine ? '<div class="badge-mine">✶ MIU</div>' : ''}
        <img class="sticker-img" src="${imgUrl}" alt="${escHtml(id)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="sticker-placeholder" style="display:none">${isMine ? '⭐' : '🃏'}</div>
        <div class="sticker-id">${escHtml(id)}</div>
        <div class="sticker-qty">×${qty}</div>
      </div>`;
    }).join('');
}

/**
 * Atualiza os atalhos de vizinhos conectados abaixo do campo de destino.
 * O campo de destino é livre (input de texto), mas mostramos botões rápidos
 * para os vizinhos já conhecidos.
 */
function renderTradeTargetOptions() {
    const container = document.getElementById('trade-target-hints');
    const offerSel  = document.getElementById('trade-offer');

    const connected = state.neighbors.filter(n => n.connected);
    if (connected.length) {
        container.innerHTML = connected.map(n =>
            `<button class="hint-btn" type="button" onclick="setTradeTarget('${escHtml(n.peer_id)}')">${escHtml(n.peer_id)}</button>`
        ).join('');
    } else {
        container.innerHTML = '<span style="color:var(--muted);font-size:12px">Nenhum vizinho conectado (você ainda pode digitar qualquer peer ID)</span>';
    }

    offerSel.innerHTML = Object.entries(state.inventory)
            .filter(([, qty]) => qty > 0)
            .map(([id, qty]) => `<option value="${escHtml(id)}">${escHtml(id)} (×${qty})</option>`).join('')
        || '<option value="">— sem figurinhas —</option>';
}

function setTradeTarget(peerId) {
    document.getElementById('trade-target-input').value = peerId;
}

function renderOffers() {
    const panel = document.getElementById('offers-panel');
    const count = Object.keys(pendingOffers).length;

    const badge = document.getElementById('offers-badge');
    if (count > 0) {
        badge.style.display = '';
        badge.textContent = count;
    } else {
        badge.style.display = 'none';
    }

    if (!count) {
        panel.innerHTML = '<div class="empty"><div class="icon">🤝</div>Nenhuma oferta pendente</div>';
        return;
    }

    panel.innerHTML = Object.entries(pendingOffers).map(([mid, msg]) => `
    <div class="offer-card">
      <div class="offer-title">📬 Proposta de <strong>${escHtml(msg.origin_peer_id)}</strong></div>
      <div class="offer-detail">
        Oferece: <strong style="color:var(--green)">${escHtml(msg.offer_sticker_id)}</strong><br>
        Quer: <strong style="color:var(--accent2)">${escHtml(msg.want_sticker_id)}</strong>
      </div>
      <div class="offer-actions">
        <button class="success" onclick="acceptOffer('${escHtml(mid)}')">✓ Aceitar</button>
        <button class="danger"  onclick="rejectOffer('${escHtml(mid)}')">✗ Recusar</button>
      </div>
    </div>
  `).join('');
}

// ─── Mensagens P2P ───────────────────────────────────────
function renderMessages() {
    const container = document.getElementById('messages-list');
    if (!messagesLog.length) {
        container.innerHTML = '<div class="empty"><div class="icon">📨</div>Nenhuma mensagem ainda</div>';
        return;
    }

    const displayed = [...messagesLog].reverse().slice(0, 100);
    container.innerHTML = displayed.map(m => {
        const dirIcon = m.direction === 'OUT' ? '📤' : '📥';
        const dirClass = m.direction === 'OUT' ? 'msg-out' : 'msg-in';
        const ts = m.ts ? m.ts.substring(11, 23) : '';
        const details = Object.entries(m)
            .filter(([k]) => !['ts','direction','type','peer'].includes(k))
            .map(([k, v]) => `<span class="msg-detail">${escHtml(k)}: ${escHtml(String(v))}</span>`)
            .join(' ');
        return `
      <div class="msg-item ${dirClass}">
        <span class="msg-dir">${dirIcon}</span>
        <span class="msg-ts">${ts}</span>
        <span class="msg-type">${escHtml(m.type)}</span>
        <span class="msg-peer">${escHtml(m.peer || '?')}</span>
        <div class="msg-details">${details}</div>
      </div>`;
    }).join('');
}

function clearMessages() {
    messagesLog = [];
    renderMessages();
}

// ═══════════════════════════════════════════════════════════
//  Ações — Conectar
// ═══════════════════════════════════════════════════════════
function connectPeer() {
    const ip   = document.getElementById('peer-ip').value.trim();
    const port = parseInt(document.getElementById('peer-port').value) || 8080;
    const pid  = document.getElementById('peer-id-input').value.trim();

    if (!ip && !pid) {
        return toast('Digite o endereço IP/hostname ou a conta do vizinho', 'error');
    }
    const connectIp = ip || pid;
    send({ type: 'CONNECT_PEER', ip: connectIp, port, peer_id: pid || undefined });
    toast(`Conectando a ${connectIp}:${port}${pid ? ' (' + pid + ')' : ''}…`, 'info');
}

// ═══════════════════════════════════════════════════════════
//  Ações — Busca
// ═══════════════════════════════════════════════════════════
function doSearch() {
    const val = document.getElementById('search-input').value.trim().toUpperCase();
    if (!val) return toast('Digite o ID da figurinha', 'error');
    const sticker_id = val.replace(/\.PNG$/i, '');
    send({ type: 'SEARCH', sticker_id });
    toast(`🔍 Buscando ${sticker_id} (flooding)…`, 'info');

    searchResults.unshift({ id: Date.now(), sticker_id, status: 'searching' });
    renderSearchResults();
}

function handleSearchResult(data) {
    const { hit, msg } = data;
    const sid = (msg.sticker_id || '').replace(/\.PNG$/i, '');

    searchResults = searchResults.filter(r => r.sticker_id !== sid || r.status !== 'searching');

    searchResults.unshift({
        id: Date.now(),
        sticker_id: sid,
        status: hit ? 'hit' : 'miss',
        found_at: msg.origin_peer_id,
        error: data.error,
    });

    renderSearchResults();

    if (hit) {
        toast(`✅ ${sid} encontrada em ${msg.origin_peer_id}!`, 'success');
    } else {
        toast(`❌ ${sid} não encontrada`, 'error');
    }
}

function renderSearchResults() {
    const container = document.getElementById('search-results');
    if (!searchResults.length) {
        container.innerHTML = '<div class="empty"><div class="icon">🔍</div>Nenhuma busca ainda</div>';
        return;
    }

    container.innerHTML = searchResults.slice(0, 20).map(r => {
        if (r.status === 'searching') {
            return `<div class="result-item">
        <div class="result-icon">⏳</div>
        <div class="result-info">
          <div class="result-title">Buscando ${escHtml(r.sticker_id)}…</div>
          <div class="result-sub">flooding pela rede</div>
        </div>
      </div>`;
        }
        if (r.status === 'hit') {
            const imgUrl = stickerImageUrl(r.sticker_id);
            return `<div class="result-item hit">
        <img src="${imgUrl}" alt="${escHtml(r.sticker_id)}"
          style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--border)"
          onerror="this.src='';this.style.display='none'" />
        <div class="result-info">
          <div class="result-title">${escHtml(r.sticker_id)} encontrada!</div>
          <div class="result-sub">em <strong>${escHtml(r.found_at || '?')}</strong></div>
        </div>
        <button onclick="openTradeModal('${escHtml(r.found_at || '')}','${escHtml(r.sticker_id)}')"
          style="font-size:11px;padding:6px 12px;white-space:nowrap">
          🔄 Propor troca
        </button>
      </div>`;
        }
        return `<div class="result-item miss">
      <div class="result-icon">❌</div>
      <div class="result-info">
        <div class="result-title">${escHtml(r.sticker_id)} não encontrada</div>
        <div class="result-sub">${escHtml(r.error || 'nenhum nó possui esta figurinha')}</div>
      </div>
    </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
//  Modal de Proposta de Troca (pós SEARCH_HIT)
// ═══════════════════════════════════════════════════════════

/**
 * Abre o modal para propor uma troca a qualquer peer_id (não precisa ser vizinho).
 * Pré-preenche o campo de destino e a figurinha desejada.
 */
function openTradeModal(targetPeerId, wantSticker) {
    const modal = document.getElementById('trade-modal');
    document.getElementById('modal-target').value = targetPeerId;
    document.getElementById('modal-want').value = wantSticker.replace(/\.PNG$/i, '');

    // Preenche o select com as figurinhas disponíveis
    const offerSel = document.getElementById('modal-offer');
    offerSel.innerHTML = Object.entries(state.inventory)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => `<option value="${escHtml(id)}">${escHtml(id)} (×${qty})</option>`)
        .join('') || '<option value="">— sem figurinhas —</option>';

    modal.classList.add('open');
}

function closeTradeModal() {
    document.getElementById('trade-modal').classList.remove('open');
}

function confirmModalTrade() {
    const target = document.getElementById('modal-target').value.trim();
    const offer  = document.getElementById('modal-offer').value;
    const want   = document.getElementById('modal-want').value.trim().toUpperCase();

    if (!target) return toast('Digite o ID do peer destino', 'error');
    if (!offer)  return toast('Selecione a figurinha a oferecer', 'error');
    if (!want)   return toast('Digite a figurinha desejada', 'error');

    send({ type: 'TRADE_OFFER', target_peer_id: target, offer_sticker_id: offer, want_sticker_id: want });
    closeTradeModal();
    // Toast de confirmação vem do servidor via TRADE_SENT
}

// ═══════════════════════════════════════════════════════════
//  Ações — Aba Trocar
// ═══════════════════════════════════════════════════════════
function sendTradeOffer() {
    const target = document.getElementById('trade-target-input').value.trim();
    const offer  = document.getElementById('trade-offer').value;
    const want   = document.getElementById('trade-want').value.trim().toUpperCase();
    if (!target) return toast('Digite o ID do peer destino (pode ser qualquer peer na rede)', 'error');
    if (!offer)  return toast('Selecione a figurinha a oferecer', 'error');
    if (!want)   return toast('Digite a figurinha desejada', 'error');
    send({ type: 'TRADE_OFFER', target_peer_id: target, offer_sticker_id: offer, want_sticker_id: want });
    // Toast de confirmação vem via TRADE_SENT do servidor
}

function handleOfferReceived(msg) {
    if (!msg || !msg.message_id) return;
    pendingOffers[msg.message_id] = msg;
    renderOffers();
    toast(`📬 Oferta de ${msg.origin_peer_id}: dá ${msg.offer_sticker_id}, quer ${msg.want_sticker_id}`, 'warning');
}

function acceptOffer(mid) {
    send({ type: 'TRADE_ACCEPT', trade_message_id: mid });
    delete pendingOffers[mid];
    renderOffers();
}

function rejectOffer(mid) {
    send({ type: 'TRADE_REJECT', trade_message_id: mid });
    delete pendingOffers[mid];
    renderOffers();
}

function quickTrade(peerId, stickerId) {
    openTradeModal(peerId, stickerId);
}

function selectNeighbor(pid) {
    switchTab('trade');
    setTimeout(() => {
        document.getElementById('trade-target-input').value = pid;
    }, 50);
}

function onStickerClick(id) {
    if (id === state.myStickerId) {
        toast(`${id} é sua figurinha autoral ⭐`, 'info');
    } else {
        switchTab('trade');
        setTimeout(() => {
            document.getElementById('trade-want').value = id;
        }, 50);
    }
}

// ═══════════════════════════════════════════════════════════
//  Tabs
// ═══════════════════════════════════════════════════════════
const TAB_IDS = ['inv', 'search', 'trade', 'offers', 'messages'];

function switchTab(tab) {
    TAB_IDS.forEach(id => {
        const btn     = document.getElementById(`tab-btn-${id}`);
        const content = document.getElementById(`tab-${id}`);
        if (btn)     btn.classList.toggle('active', id === tab);
        if (content) content.classList.toggle('active', id === tab);
    });
    if (tab === 'messages') renderMessages();
}

// ═══════════════════════════════════════════════════════════
//  Log
// ═══════════════════════════════════════════════════════════
function appendLog(entry) {
    const area = document.getElementById('log-area');
    const div  = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `
    <span class="log-ts">${entry.ts || ''}</span>
    <span class="log-tag ${entry.tag}">${entry.tag}</span>
    <span class="log-msg">${escHtml(entry.msg)}${entry.data && Object.keys(entry.data).length ? ' · ' + escHtml(JSON.stringify(entry.data).slice(0, 60)) : ''}</span>
  `;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

function clearLog() {
    document.getElementById('log-area').innerHTML = '';
}

// ═══════════════════════════════════════════════════════════
//  Toast
// ═══════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
    const c  = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════
//  Utilitários
// ═══════════════════════════════════════════════════════════
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}