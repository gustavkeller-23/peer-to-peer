// peer-engine.js — Busca de figurinhas por inundação (flood search)
//
// Como funciona o flood search:
//  1. Nó A inicia: gera um query_id único e envia SEARCH para todos os vizinhos com TTL=7
//  2. Cada nó que recebe SEARCH verifica se já processou aquele query_id (deduplicação)
//  3. Se não processou: verifica inventário local e repassa para vizinhos com TTL-1
//  4. Quem tiver a figurinha envia SEARCH_HIT de volta pelo caminho que veio
//  5. O HIT é roteado de volta até chegar ao nó A que iniciou a busca
//
// Proteções contra flooding:
//  - TTL: cada SEARCH é descartado se ttl <= 0 (nunca repassa com ttl negativo)
//  - Deduplicação: query_id já visto → descartado imediatamente
//  - Rate limit: no máximo RATE_LIMIT_PER_PEER buscas/s por peer remoto
//  - Cooldown UI: mínimo de SEARCH_COOLDOWN_MS entre buscas da mesma figurinha pela UI
//
// Retry:
//  - Se nenhum resultado chegar em SEARCH_TIMEOUT_MS, a busca é repetida com novo query_id
//  - Na 3ª tentativa sem resposta, a busca é cancelada e a UI é notificada
//
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { buildSearch, buildSearchHit } = require('./protocol');

const DEFAULT_TTL          = 7;    // Número máximo de saltos na rede
const SEARCH_TIMEOUT_MS    = 5000; // Espera 5s por resultados antes de tentar novamente
const MAX_SEARCH_ATTEMPTS  = 3;    // Cancela após 3 tentativas sem resposta
const SEARCH_COOLDOWN_MS   = 2000; // Mínimo de 2s entre buscas da mesma figurinha (UI)
const RATE_LIMIT_PER_PEER  = 10;   // Máximo de SEARCHes por segundo por peer remoto
const RATE_LIMIT_WINDOW_MS = 1000; // Janela de 1s para o rate limit
const MAX_QUERY_CACHE      = 5000; // Máximo de query_ids em cache antes de limpar

class PeerEngine extends EventEmitter {
  constructor(config, inventory, neighborManager) {
    super();
    this.peerId      = config.peer_id;
    this.peerIp      = config.ip || null; // IP local para preencher origin_peer_ip
    this.ttl         = config.default_ttl || DEFAULT_TTL;
    this.inventory   = inventory;
    this.neighbors   = neighborManager;

    // query_id → ws de origem (null = eu sou o originador)
    // Serve tanto para deduplicação quanto para roteamento reverso dos HITs
    this.queryRoutes = new Map();

    // query_id → lista de resultados (só para buscas que eu iniciei)
    this.searchResults = new Map();

    // sticker_id → { attempts, timer, rootQueryId, lastSearchAt }
    // Rastreia tentativas de retry por figurinha buscada
    this.pendingSearches = new Map();

    // peer_id → { count, windowStart } — rate limit por peer remoto
    this._rateCounters = new Map();

    // sticker_id → timestamp da última busca iniciada pela UI (cooldown)
    this._lastSearchTime = new Map();

    // Mapeia queryId efêmero → rootQueryId estável (para retries)
    this._queryToRoot = new Map();

    // Set<string> de chaves "query_id:origin_peer_id" para deduplicar SEARCH_HITs
    // Evita reencaminhar/processar o mesmo HIT centenas de vezes
    this._seenHits = new Set();

    // Limpar cache a cada 5 minutos
    setInterval(() => this._cleanCache(), 5 * 60 * 1000);
  }

  // Iniciar uma busca (chamado pela UI)
  // Retorna o rootQueryId — ID estável que identifica esta "sessão de busca"
  // mesmo que haja retries com novos query_ids internos.
  search(stickerId) {
    // Cooldown: evitar spam da mesma figurinha
    const lastTime = this._lastSearchTime.get(stickerId) || 0;
    const now = Date.now();
    if (now - lastTime < SEARCH_COOLDOWN_MS) {
      const wait = SEARCH_COOLDOWN_MS - (now - lastTime);
      console.log(`[BUSCA] ⏳ Aguarde ${wait}ms para buscar ${stickerId} novamente`);
      // Retorna o rootQueryId existente se houver sessão ativa
      const existingSession = this.pendingSearches.get(stickerId);
      if (existingSession) return existingSession.rootQueryId;
      return null;
    }

    this._lastSearchTime.set(stickerId, now);

    // Se já há uma busca ativa para esta figurinha, cancelar a anterior
    if (this.pendingSearches.has(stickerId)) {
      this._cancelRetryTimer(stickerId);
    }

    const rootQueryId = uuidv4();

    // Registrar sessão de retry
    this.pendingSearches.set(stickerId, {
      attempts:    1,
      rootQueryId,
      timer:       null,
    });

    this._doSearch(stickerId, rootQueryId);
    return rootQueryId;
  }

  // Executa o flood search de fato (usado tanto na 1ª chamada quanto nos retries)
  _doSearch(stickerId, rootQueryId) {
    const session = this.pendingSearches.get(stickerId);
    if (!session) return;

    const queryId = uuidv4();

    // Registrar antes de enviar para ignorar qualquer eco de volta
    this.queryRoutes.set(queryId, null); // null = sou o originador

    // Compartilhar a lista de resultados entre todos os query_ids desta sessão
    // apontando todos para o mesmo array (usando rootQueryId como chave)
    if (!this.searchResults.has(rootQueryId)) {
      this.searchResults.set(rootQueryId, []);
    }
    // Mapear queryId → rootQueryId para que handleSearchHit use a lista certa
    this._queryToRoot.set(queryId, rootQueryId);

    // Verificar primeiro no próprio inventário (só na 1ª tentativa)
    if (session.attempts === 1 && this.inventory.has(stickerId)) {
      this._addResult(rootQueryId, { origin_peer_id: this.peerId, sticker_id: stickerId, query_id: rootQueryId });
      this.emit('search_hit', { origin_peer_id: this.peerId, sticker_id: stickerId, query_id: rootQueryId });
    }

    // Enviar SEARCH para cada vizinho com TTL completo
    const peers = this.neighbors.getConnectedPeers();
    for (const { peer_id } of peers) {
      this.neighbors.sendTo(peer_id, buildSearch(this.peerId, this.peerId, peer_id, stickerId, this.ttl, queryId, this.peerIp));
    }

    const attempt = session.attempts;
    console.log(`[BUSCA] Tentativa ${attempt}/${MAX_SEARCH_ATTEMPTS}: ${stickerId} (query: ${queryId.slice(0, 8)}...)`);
    this.emit('search_started', { query_id: rootQueryId, sticker_id: stickerId, attempt });

    // Agendar verificação de timeout para retry/cancelamento
    session.timer = setTimeout(() => this._onSearchTimeout(stickerId, rootQueryId), SEARCH_TIMEOUT_MS);
  }

  // Chamado quando o timeout dispara sem resultados
  _onSearchTimeout(stickerId, rootQueryId) {
    const session = this.pendingSearches.get(stickerId);
    if (!session || session.rootQueryId !== rootQueryId) return;

    const results = this.searchResults.get(rootQueryId) || [];

    if (results.length > 0) {
      // Já temos resultados — tudo certo, encerrar sessão normalmente
      console.log(`[BUSCA] Encerrada com ${results.length} resultado(s): ${stickerId}`);
      this.pendingSearches.delete(stickerId);
      return;
    }

    if (session.attempts >= MAX_SEARCH_ATTEMPTS) {
      // Esgotou as tentativas — cancelar e notificar UI
      console.log(`[BUSCA] ✗ Cancelada após ${MAX_SEARCH_ATTEMPTS} tentativas sem resposta: ${stickerId}`);
      this.pendingSearches.delete(stickerId);
      this.emit('search_timeout', { query_id: rootQueryId, sticker_id: stickerId, attempts: MAX_SEARCH_ATTEMPTS });
      return;
    }

    // Tentar novamente
    session.attempts += 1;
    console.log(`[BUSCA] Sem resposta. Tentando novamente (${session.attempts}/${MAX_SEARCH_ATTEMPTS})...`);
    this.emit('search_retry', { query_id: rootQueryId, sticker_id: stickerId, attempt: session.attempts });
    this._doSearch(stickerId, rootQueryId);
  }

  _cancelRetryTimer(stickerId) {
    const session = this.pendingSearches.get(stickerId);
    if (session?.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    this.pendingSearches.delete(stickerId);
  }

  // Processar SEARCH recebido de um vizinho
  handleSearch(msg, sourceWs) {
    const { query_id, sticker_id, ttl, sender_peer_id, origin_peer_id } = msg;

    // ── Guarda 1: TTL ────────────────────────────────────────────────────────
    // Descartar mensagens com TTL inválido ou esgotado ANTES de qualquer coisa.
    // Garante que a inundação sempre termina.
    const ttlNum = Number(ttl);
    if (!Number.isFinite(ttlNum) || ttlNum <= 0) {
      return; // TTL esgotado — não repassar nem logar
    }

    // ── Guarda 2: Deduplicação ───────────────────────────────────────────────
    // Descartar se já processamos esta busca (regra obrigatória da spec)
    if (this.queryRoutes.has(query_id)) {
      return; // Duplicata — descartar silenciosamente
    }

    // ── Guarda 3: Rate limit por peer ────────────────────────────────────────
    // Limitar o número de SEARCHes aceitas por segundo de um mesmo peer remoto
    // para evitar que um peer mal-configurado inunde a rede.
    if (origin_peer_id && !this._checkRateLimit(origin_peer_id)) {
      console.warn(`[BUSCA] ⚠ Rate limit: descartando SEARCH de ${origin_peer_id} (muitas buscas/s)`);
      return;
    }

    // ── Cache size guard ──────────────────────────────────────────────────────
    if (this.queryRoutes.size >= MAX_QUERY_CACHE) {
      console.warn('[BUSCA] ⚠ Cache de queries cheio — limpando...');
      this._cleanCache(true);
    }

    // Guardar rota reversa para poder enviar o HIT de volta
    this.queryRoutes.set(query_id, sourceWs);
    console.log(`[BUSCA] Recebida de ${sender_peer_id || origin_peer_id}: ${sticker_id} (TTL: ${ttlNum})`);

    // Se temos a figurinha, responder com SEARCH_HIT pelo mesmo caminho que veio
    if (this.inventory.has(sticker_id)) {
      const hit = buildSearchHit(this.peerId, this.peerId, origin_peer_id, query_id, sticker_id);
      this.neighbors.sendToWs(sourceWs, hit);
      console.log(`[BUSCA] ✓ HIT! Tenho ${sticker_id}`);
      this.emit('search_hit_sent', { query_id, sticker_id });
    }

    // Repassar para os outros vizinhos se ainda há TTL suficiente (exceto para quem nos enviou)
    const nextTtl = ttlNum - 1;
    if (nextTtl > 0) {
      for (const { peer_id } of this.neighbors.getConnectedPeers()) {
        if (peer_id === sender_peer_id) continue; // não devolver para quem enviou
        this.neighbors.sendTo(peer_id, buildSearch(origin_peer_id, this.peerId, peer_id, sticker_id, nextTtl, query_id, msg.origin_peer_ip));
      }
      console.log(`[BUSCA] Repassada com TTL ${nextTtl}`);
    }
  }

  // Processar SEARCH_HIT recebido
  handleSearchHit(msg, sourceWs) {
    const { query_id, sticker_id, origin_peer_id } = msg;

    // Deduplicar: ignorar HITs repetidos do mesmo peer para o mesmo query
    const hitKey = `${query_id}:${origin_peer_id}`;
    if (this._seenHits.has(hitKey)) return;
    this._seenHits.add(hitKey);

    const routeWs = this.queryRoutes.get(query_id);

    if (routeWs === null) {
      // Eu iniciei esta busca — resolver o rootQueryId (pode ser retry)
      const rootQueryId = this._queryToRoot.get(query_id) || query_id;

      this._addResult(rootQueryId, { origin_peer_id, sticker_id, query_id: rootQueryId });
      this.emit('search_hit', { origin_peer_id, sticker_id, query_id: rootQueryId });

      // Como chegou pelo menos um resultado, cancelar o timer de retry desta figurinha
      const session = this.pendingSearches.get(sticker_id);
      if (session && session.rootQueryId === rootQueryId) {
        clearTimeout(session.timer);
        session.timer = null;
        // Não removemos da pendingSearches ainda — pode chegar mais resultados
        // O timer final será disparado normalmente no próximo ciclo se não houver mais
      }
    } else if (routeWs) {
      // Não sou o originador — encaminhar HIT de volta pelo caminho reverso
      this.neighbors.sendToWs(routeWs, msg);
      console.log(`[BUSCA] HIT de ${origin_peer_id} encaminhado de volta`);
    }
  }

  // SEARCH_MISS é opcional na spec — ignorar silenciosamente
  handleSearchMiss(msg) {
    // Não logar: alguns peers enviam MISS a cada salto, inundando o console
  }

  // Resultados acumulados de uma busca iniciada por este nó
  getSearchResults(queryId) {
    return this.searchResults.get(queryId) || [];
  }

  // ─── Helpers internos ──────────────────────────────────────────────────────

  _addResult(queryId, hit) {
    if (!this.searchResults.has(queryId)) this.searchResults.set(queryId, []);
    this.searchResults.get(queryId).push(hit);
    console.log(`[BUSCA] Resultado: ${hit.origin_peer_id} tem ${hit.sticker_id}`);
  }

  // Rate limit: retorna true se o peer ainda está dentro do limite
  _checkRateLimit(peerId) {
    const now = Date.now();
    let counter = this._rateCounters.get(peerId);

    if (!counter || now - counter.windowStart >= RATE_LIMIT_WINDOW_MS) {
      // Nova janela
      counter = { count: 1, windowStart: now };
      this._rateCounters.set(peerId, counter);
      return true;
    }

    counter.count += 1;
    if (counter.count > RATE_LIMIT_PER_PEER) return false;
    return true;
  }

  _cleanCache(force = false) {
    if (force || this.queryRoutes.size > MAX_QUERY_CACHE) {
      this.queryRoutes.clear();
      this.searchResults.clear();
      this._queryToRoot.clear();
      this.pendingSearches.clear();
      this._rateCounters.clear();
      this._seenHits.clear();
      console.log('[BUSCA] Cache de queries limpo');
    }
  }
}

module.exports = PeerEngine;
