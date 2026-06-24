// app.js — Frontend logic: WebSocket connection to local server and UI rendering
(function () {
  'use strict';

  // ===== STATE =====
  let ws = null;
  let state = {
    peer_id: '—',
    sticker_id: '—',
    inventory: {},
    total_unique: 0,
    total_count: 0,
    peers: [],
    pending_trades: [],
    trade_history: [],
    search_results: {},
  };

  let currentIncomingTrade = null;

  // ===== DOM ELEMENTS =====
  const $ = (id) => document.getElementById(id);
  const peerIdEl = $('peer-id-display');
  const stickerIdEl = $('sticker-id-display');
  const connectionStatus = $('connection-status');
  const statUnique = $('stat-unique');
  const statTotal = $('stat-total');
  const statPeers = $('stat-peers');
  const inventoryGrid = $('inventory-grid');
  const inventoryCount = $('inventory-count');
  const neighborsList = $('neighbors-list');
  const tabTradeBadge = $('tab-trade-badge');
  const neighborsCount = $('neighbors-count');
  const searchInput = $('search-input');
  const searchBtn = $('search-btn');
  const searchResults = $('search-results');
  const tradePending = $('trade-pending');
  const tradeHistory = $('trade-history');
  const pendingTradesCount = $('pending-trades-count');
  const logContainer = $('log-container');
  const neighborUrlInput = $('neighbor-url-input');
  const neighborPortInput = $('neighbor-port-input');
  const addNeighborBtn = $('add-neighbor-btn');
  const clearLogBtn = $('clear-log-btn');

  // Modals
  const tradeModal = $('trade-modal');
  const tradeModalClose = $('trade-modal-close');
  const tradeCancelBtn = $('trade-cancel-btn');
  const tradeSubmitBtn = $('trade-submit-btn');
  const tradeTargetPeer = $('trade-target-peer');
  const tradeOfferSticker = $('trade-offer-sticker');
  const tradeWantSticker = $('trade-want-sticker');

  const incomingTradeModal = $('incoming-trade-modal');
  const incomingTradeDetails = $('incoming-trade-details');
  const incomingAcceptBtn = $('incoming-accept-btn');
  const incomingRejectBtn = $('incoming-reject-btn');

  // Sticker preview modal
  const stickerPreviewModal = $('sticker-preview-modal');
  const stickerPreviewImg = $('sticker-preview-img');
  const stickerPreviewName = $('sticker-preview-name');
  const stickerPreviewQty = $('sticker-preview-qty');
  const stickerPreviewClose = $('sticker-preview-close');

  // ===== WEBSOCKET =====
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws/ui`;
    addLog('Conectando a ' + url + '...', 'info');

    ws = new WebSocket(url);

    ws.onopen = () => {
      connectionStatus.className = 'status-indicator connected';
      connectionStatus.querySelector('.status-text').textContent = 'Conectado';
      addLog('✓ Conectado ao servidor', 'info');
    };

    ws.onclose = () => {
      connectionStatus.className = 'status-indicator disconnected';
      connectionStatus.querySelector('.status-text').textContent = 'Desconectado';
      addLog('✗ Desconectado. Reconectando em 3s...', 'error');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      addLog('Erro na conexão WebSocket', 'error');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('Parse error:', e);
      }
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ===== MESSAGE HANDLER =====
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'init':
        state = { ...state, ...msg.data };
        renderAll();
        addLog(`Nó: ${state.peer_id} | Figurinha: ${state.sticker_id}`, 'info');
        break;

      case 'inventory_update':
        state.inventory = msg.data;
        state.total_unique = msg.total_unique;
        state.total_count = msg.total_count;
        renderInventory();
        renderStats();
        break;

      case 'neighbor_connected':
        state.peers = msg.data.peers;
        renderNeighbors();
        renderStats();
        addLog(`👥 Vizinho conectado: ${msg.data.peer_id}`, 'incoming');
        break;

      case 'neighbor_disconnected':
        state.peers = msg.data.peers;
        renderNeighbors();
        renderStats();
        addLog(`👥 Vizinho desconectado: ${msg.data.peer_id}`, 'error');
        break;

      case 'search_initiated':
        addLog(`🔍 Busca iniciada: ${msg.data.sticker_id} (${msg.data.query_id.substring(0, 8)}...)`, 'outgoing');
        if (!state.search_results[msg.data.query_id]) {
          state.search_results[msg.data.query_id] = { sticker_id: msg.data.sticker_id, hits: [], status: 'searching', attempt: 1 };
        }
        renderSearchResults();
        break;

      case 'search_started':
        break;

      case 'search_hit':
        addLog(`✓ HIT: ${msg.data.origin_peer_id} tem ${msg.data.sticker_id}`, 'incoming');
        if (state.search_results[msg.data.query_id]) {
          state.search_results[msg.data.query_id].hits.push(msg.data);
          // Limpar status de retry ao receber resultado
          state.search_results[msg.data.query_id].status = 'found';
        }
        renderSearchResults();
        break;

      case 'search_retry':
        addLog(`🔄 Sem resposta. Repetindo busca (tentativa ${msg.data.attempt}/3): ${msg.data.sticker_id}`, 'info');
        if (state.search_results[msg.data.query_id]) {
          state.search_results[msg.data.query_id].status = 'retrying';
          state.search_results[msg.data.query_id].attempt = msg.data.attempt;
        }
        renderSearchResults();
        break;

      case 'search_timeout':
        addLog(`⏱ Busca cancelada após 3 tentativas sem resposta: ${msg.data.sticker_id}`, 'error');
        if (state.search_results[msg.data.query_id]) {
          state.search_results[msg.data.query_id].status = 'timeout';
        }
        renderSearchResults();
        break;

      case 'search_hit_sent':
        addLog(`📤 HIT enviado: ${msg.data.sticker_id}`, 'outgoing');
        break;

      case 'trade_received':
        addLog(`📨 Proposta recebida de ${msg.data.initiator}`, 'trade');
        currentIncomingTrade = msg.data;
        showIncomingTradeModal(msg.data);
        state.pending_trades.push(msg.data);
        renderTrades();
        break;

      case 'trade_proposed':
        addLog(`📤 Proposta enviada para ${msg.data.target}`, 'trade');
        state.pending_trades.push(msg.data);
        renderTrades();
        break;

      case 'trade_accepted':
        addLog(`✓ Troca aceita: ${msg.data.trade_id.substring(0, 8)}...`, 'trade');
        removePendingTrade(msg.data.trade_id);
        state.trade_history.unshift(msg.data);
        renderTrades();
        break;

      case 'trade_rejected':
        addLog(`✗ Troca rejeitada: ${msg.data.reason || 'sem motivo'}`, 'error');
        removePendingTrade(msg.data.trade_id);
        state.trade_history.unshift(msg.data);
        renderTrades();
        break;

      case 'trade_completed':
        addLog(`✓ Troca concluída!`, 'trade');
        removePendingTrade(msg.data.trade_id);
        state.trade_history.unshift(msg.data);
        renderTrades();
        break;

      case 'trade_confirmed':
        addLog(`✓ Transferência confirmada`, 'trade');
        // Remove do pendente (peer aceitante ainda pode ter no pendente)
        removePendingTrade(msg.data.trade_id);
        // Atualiza status no histórico se já estiver lá (de ACCEPTED para CONFIRMED)
        {
          const idx = state.trade_history.findIndex(t => t.trade_id === msg.data.trade_id);
          if (idx !== -1) {
            state.trade_history[idx] = { ...state.trade_history[idx], status: 'CONFIRMED' };
          } else {
            state.trade_history.unshift(msg.data);
          }
        }
        renderTrades();
        break;

      case 'log':
        if (msg.message && msg.message.type) {
          const dir = msg.direction === 'incoming' ? '⬇️' : '⬆️';
          const sender = msg.message.sender_peer_id || msg.message.origin_peer_id || '?';
          addLog(`${dir} ${msg.message.type} de ${sender}`, msg.direction);
        }
        break;

      case 'neighbor_update':
        // Recarregar lista de vizinhos via get_status ao receber qualquer HELLO
        send({ action: 'get_status' });
        break;

      case 'error':
        addLog(`❌ Erro: ${msg.data.message}`, 'error');
        break;

      case 'ui_event':
        break;

      case 'status':
        state = { ...state, ...msg.data };
        renderAll();
        break;

      default:
        console.log('Unknown msg type:', msg.type);
    }
  }

  function removePendingTrade(tradeId) {
    state.pending_trades = state.pending_trades.filter(t => t.trade_id !== tradeId);
  }

  // ===== RENDERERS =====
  function renderAll() {
    peerIdEl.textContent = state.peer_id;
    stickerIdEl.textContent = state.sticker_id;
    renderStats();
    renderInventory();
    renderNeighbors();
    renderTrades();
  }

  function renderStats() {
    statUnique.textContent = state.total_unique;
    statTotal.textContent = state.total_count;
    statPeers.textContent = state.peers.length;
  }

  // Base URL for sticker images from GitHub
  const STICKER_IMG_BASE = 'https://raw.githubusercontent.com/rgcoelho01/album/main/docs/images/';
  const STICKER_PLACEHOLDER = STICKER_IMG_BASE + 'FIG-XX.png';

  function getStickerImageUrl(stickerId) {
    return STICKER_IMG_BASE + stickerId + '.png';
  }

  function renderInventory() {
    const items = state.inventory;
    // Quantidade de figurinhas únicas possuídas (quantidade > 0)
    const ownedKeys = Object.keys(items).filter(id => items[id] > 0).sort();
    inventoryCount.textContent = ownedKeys.length;

    // Gerar lista de todas as 28 figurinhas (FIG-01 a FIG-28)
    const allStickerIds = [];
    for (let i = 1; i <= 28; i++) {
      const pad = i < 10 ? '0' + i : i;
      allStickerIds.push(`FIG-${pad}`);
    }

    inventoryGrid.innerHTML = allStickerIds.map(id => {
      const qty = items[id] || 0;
      const isOwn = id === state.sticker_id;
      const hasSticker = qty > 0;
      const imgUrl = getStickerImageUrl(id);

      if (hasSticker) {
        return `<div class="sticker-card owned${isOwn ? ' own' : ''}" onclick="app.previewSticker('${id}', ${qty})">
          <div class="sticker-img-wrapper">
            <img src="${imgUrl}" alt="${id}" class="sticker-img" onerror="this.src='${STICKER_PLACEHOLDER}'" loading="lazy" />
            ${isOwn ? '<span class="sticker-own-badge">⭐</span>' : ''}
          </div>
          <div class="sticker-name">${id}</div>
          <div class="sticker-qty">×${qty}</div>
        </div>`;
      } else {
        return `<div class="sticker-card missing">
          <div class="sticker-img-placeholder">
            <span class="sticker-placeholder-icon">🎴</span>
          </div>
          <div class="sticker-name">${id}</div>
          <div class="sticker-qty missing">×0</div>
        </div>`;
      }
    }).join('');

    // Atualiza o dropdown de oferta de troca apenas com as figurinhas que possuímos
    updateTradeOfferDropdown(ownedKeys, items);
  }

  function updateTradeOfferDropdown(keys, items) {
    tradeOfferSticker.innerHTML = keys.map(id =>
      `<option value="${id}">${id} (×${items[id]})</option>`
    ).join('');
  }

  function renderNeighbors() {
    const peers = state.peers;
    neighborsCount.textContent = peers.length;

    if (peers.length === 0) {
      neighborsList.innerHTML = '<div class="empty-state">Nenhum vizinho conectado</div>';
      return;
    }

    neighborsList.innerHTML = peers.map(p => `
      <div class="neighbor-item">
        <div>
          <span class="neighbor-id">${p.peer_id}</span>
          <span class="neighbor-dir">(${p.direction})</span>
        </div>
        <span class="neighbor-dot"></span>
      </div>
    `).join('');
  }

  function renderSearchResults() {
    const queries = Object.entries(state.search_results);
    if (queries.length === 0) {
      searchResults.innerHTML = '<div class="empty-state">Nenhuma busca realizada</div>';
      return;
    }

    let html = '';
    // Show most recent first
    for (let i = queries.length - 1; i >= 0; i--) {
      const [queryId, data] = queries[i];
      const status = data.status || 'searching';

      // Status badge
      let statusBadge = '';
      if (status === 'searching') {
        statusBadge = `<span class="search-status searching">⏳ Buscando…</span>`;
      } else if (status === 'retrying') {
        statusBadge = `<span class="search-status retrying">🔄 Tentativa ${data.attempt}/3…</span>`;
      } else if (status === 'timeout') {
        statusBadge = `<span class="search-status timeout">⏱ Cancelada — sem resposta após 3 tentativas</span>`;
      }

      html += `<div class="search-query-group">
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;display:flex;align-items:center;gap:6px;">
          🔍 ${data.sticker_id} <span style="opacity:0.5">(${queryId.substring(0, 8)}...)</span>
          ${statusBadge}
        </div>`;

      if (data.hits.length === 0) {
        if (status === 'timeout') {
          html += '<div class="empty-state" style="padding:6px;color:var(--error,#f87171)">Nenhum nó encontrado com essa figurinha.</div>';
        } else {
          html += '<div class="empty-state" style="padding:6px">Aguardando resultados...</div>';
        }
      } else {
        for (const hit of data.hits) {
          const qtyLabel = 'disponível';
          html += `<div class="search-hit">
            <div class="search-hit-info">
              <span class="search-hit-peer">${hit.origin_peer_id}</span>
              <span class="search-hit-qty">${qtyLabel}</span>
            </div>
            <button class="btn btn-primary btn-sm" onclick="app.openTrade('${hit.origin_peer_id}', '${hit.sticker_id}')">
              Trocar
            </button>
          </div>`;
        }
      }
      html += '</div>';
    }
    searchResults.innerHTML = html;
  }


  function renderTrades() {
    // Pending
    const pending = state.pending_trades.filter(t => t.status === 'PENDING');
    const pendingCount = pending.length;
    pendingTradesCount.textContent = pendingCount;
    pendingTradesCount.style.display = pendingCount > 0 ? 'inline' : 'none';
    if (tabTradeBadge) {
      tabTradeBadge.style.display = pendingCount > 0 ? 'block' : 'none';
    }

    if (pending.length === 0) {
      tradePending.innerHTML = '<div class="empty-state">Nenhuma troca pendente</div>';
    } else {
      tradePending.innerHTML = pending.map(t => {
        const isIncoming = t.direction === 'incoming';
        const peer = isIncoming ? t.initiator : t.target;
        const actions = isIncoming ? `
          <div class="trade-item-actions">
            <button class="btn btn-success btn-sm" onclick="app.acceptTrade('${t.trade_id}')">Aceitar</button>
            <button class="btn btn-danger btn-sm" onclick="app.rejectTrade('${t.trade_id}')">Recusar</button>
          </div>` : '<span style="font-size:0.72rem;color:var(--text-muted)">Aguardando resposta...</span>';
        return `<div class="trade-item">
          <div class="trade-item-header">
            <span class="trade-item-peer">${isIncoming ? '📨' : '📤'} ${peer}</span>
            <span class="trade-item-status pending">Pendente</span>
          </div>
          <div class="trade-item-detail">
            ${isIncoming
              ? `Oferece ${t.offer_sticker_id} · Quer ${t.want_sticker_id}`
              : `Ofereço ${t.offer_sticker_id} · Quero ${t.want_sticker_id}`}
          </div>
          ${actions}
        </div>`;
      }).join('');
    }

    // History
    if (state.trade_history.length === 0) {
      tradeHistory.innerHTML = '<div class="empty-state">Nenhuma troca realizada</div>';
    } else {
      tradeHistory.innerHTML = state.trade_history.slice(0, 20).map(t => {
        const statusClass = (t.status || '').toLowerCase();
        const statusLabel = t.status === 'CONFIRMED' ? 'Concluída' : t.status === 'ACCEPTED' ? 'Aceita' : t.status === 'REJECTED' ? 'Rejeitada' : t.status;
        const peer = t.direction === 'incoming' ? t.initiator : t.target;
        return `<div class="trade-item">
          <div class="trade-item-header">
            <span class="trade-item-peer">${peer}</span>
            <span class="trade-item-status ${statusClass}">${statusLabel}</span>
          </div>
          <div class="trade-item-detail">
            ${t.offer_sticker_id} ⇄ ${t.want_sticker_id}
          </div>
        </div>`;
      }).join('');
    }
  }

  // ===== LOG =====
  function addLog(text, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type || 'info'}`;
    const time = new Date().toLocaleTimeString('pt-BR');
    entry.textContent = `[${time}] ${text}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;

    // Keep max 200 entries
    while (logContainer.children.length > 200) {
      logContainer.removeChild(logContainer.firstChild);
    }
  }

  // ===== MODALS =====
  function showTradeModal(targetPeer, wantSticker) {
    tradeTargetPeer.value = targetPeer || '';
    tradeWantSticker.value = wantSticker || '';
    tradeModal.style.display = 'flex';
  }

  function hideTradeModal() {
    tradeModal.style.display = 'none';
  }

  function showIncomingTradeModal(trade) {
    incomingTradeDetails.innerHTML = `
      <p><strong>De:</strong> <span class="highlight">${trade.initiator}</span></p>
      <p><strong>Oferece:</strong> <span class="highlight">${trade.offer_sticker_id}</span></p>
      <p><strong>Quer:</strong> <span class="highlight">${trade.want_sticker_id}</span></p>
    `;
    incomingTradeModal.style.display = 'flex';
  }

  function hideIncomingTradeModal() {
    incomingTradeModal.style.display = 'none';
    currentIncomingTrade = null;
  }

  // ===== EVENT LISTENERS =====
  searchBtn.addEventListener('click', () => {
    const stickerId = searchInput.value.trim().toUpperCase();
    if (!stickerId) return;
    send({ action: 'search', sticker_id: stickerId });
    searchInput.value = '';
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchBtn.click();
  });

  addNeighborBtn.addEventListener('click', () => {
    const ip = neighborUrlInput.value.trim();
    if (!ip) return;
    const port = parseInt(neighborPortInput.value) || 8080;
    neighborPortInput.value = port; // garante que nunca fica vazio
    const url = `ws://${ip}:${port}`;
    send({ action: 'add_neighbor', url });
    neighborUrlInput.value = '';
    addLog(`➕ Adicionando vizinho: ${url}`, 'outgoing');
  });

  neighborUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNeighborBtn.click();
  });

  neighborPortInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNeighborBtn.click();
  });

  // Garantir que o campo de porta nunca fique vazio
  neighborPortInput.addEventListener('blur', () => {
    if (!neighborPortInput.value || parseInt(neighborPortInput.value) < 1) {
      neighborPortInput.value = 8080;
    }
  });

  clearLogBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('Log limpo', 'info');
  });

  // Tabs da Sub-seção de Trocas (Pendente / Histórico)
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`trade-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Main Navigation Tabs (Figurinhas, Buscar, Trocas)
  const mainNavTabs = document.querySelectorAll('.main-nav-tab');
  const mainPanels = {
    'inventory-panel': $('inventory-panel'),
    'search-panel': $('search-panel'),
    'trade-panel': $('trade-panel')
  };

  mainNavTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mainNavTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.target;
      Object.keys(mainPanels).forEach(key => {
        if (mainPanels[key]) {
          if (key === targetId) {
            mainPanels[key].style.display = 'block';
          } else {
            mainPanels[key].style.display = 'none';
          }
        }
      });
    });
  });

  // Trade modal
  tradeModalClose.addEventListener('click', hideTradeModal);
  tradeCancelBtn.addEventListener('click', hideTradeModal);
  tradeModal.querySelector('.modal-overlay').addEventListener('click', hideTradeModal);

  tradeSubmitBtn.addEventListener('click', () => {
    const targetPeer = tradeTargetPeer.value.trim().toUpperCase();
    const offerSticker = tradeOfferSticker.value;
    const wantSticker = tradeWantSticker.value.trim().toUpperCase();

    if (!targetPeer || !offerSticker || !wantSticker) {
      addLog('❌ Preencha todos os campos da troca', 'error');
      return;
    }

    send({
      action: 'trade_propose',
      target_peer_id: targetPeer,
      offer_sticker_id: offerSticker,
      want_sticker_id: wantSticker,
    });

    hideTradeModal();
  });

  // Incoming trade modal
  incomingAcceptBtn.addEventListener('click', () => {
    if (currentIncomingTrade) {
      send({ action: 'trade_accept', trade_id: currentIncomingTrade.trade_id });
    }
    hideIncomingTradeModal();
  });

  incomingRejectBtn.addEventListener('click', () => {
    if (currentIncomingTrade) {
      send({ action: 'trade_reject', trade_id: currentIncomingTrade.trade_id, reason: 'Recusada pelo usuário' });
    }
    hideIncomingTradeModal();
  });

  incomingTradeModal.querySelector('.modal-overlay').addEventListener('click', hideIncomingTradeModal);

  // ===== PUBLIC API (for inline onclick handlers) =====
  window.app = {
    openTrade: (targetPeer, wantSticker) => {
      showTradeModal(targetPeer, wantSticker);
    },
    acceptTrade: (tradeId) => {
      send({ action: 'trade_accept', trade_id: tradeId });
    },
    rejectTrade: (tradeId) => {
      send({ action: 'trade_reject', trade_id: tradeId, reason: 'Recusada pelo usuário' });
    },
    previewSticker: (stickerId, qty) => {
      stickerPreviewImg.src = getStickerImageUrl(stickerId);
      stickerPreviewImg.alt = stickerId;
      stickerPreviewImg.onerror = function() { this.src = STICKER_PLACEHOLDER; };
      stickerPreviewName.textContent = stickerId;
      stickerPreviewQty.textContent = `×${qty}`;
      stickerPreviewModal.style.display = 'flex';
    },
  };

  // Sticker preview modal close handlers
  function hideStickerPreview() { stickerPreviewModal.style.display = 'none'; }
  stickerPreviewClose.addEventListener('click', hideStickerPreview);
  stickerPreviewModal.querySelector('.modal-overlay').addEventListener('click', hideStickerPreview);

  // ===== INIT =====
  connect();
})();
