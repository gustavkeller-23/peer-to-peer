// neighbor-manager.js — Gerencia conexões WebSocket com outros peers da rede
//
// Descoberta automática de vizinhos:
//   - Ao conectar a um peer, enviamos HELLO com a lista dos nossos URLs conhecidos
//   - Ao receber HELLO com campo `peers`, tentamos conectar nos novos endereços
//   - Isso permite alcançar "vizinhos dos vizinhos" automaticamente
//
const WebSocket = require('ws');
const EventEmitter = require('events');
const { buildHello } = require('./protocol');

const RECONNECT_DELAY_MS = 3000; // Tempo de espera antes de tentar reconectar

class NeighborManager extends EventEmitter {
  constructor(config) {
    super();
    this.peerId = config.peer_id;
    this.port   = config.port || 8080;

    // Map<peerId, { ws, url, direction }>
    // Guarda a conexão WebSocket de cada vizinho conhecido
    this.peers = new Map();

    // Set<url> — todos os URLs que já tentamos ou estamos conectados
    // Evita tentativas duplicadas ao receber peers via HELLO
    this.knownUrls = new Set();

    // WeakSet<WebSocket> — sockets para os quais já enviamos nosso HELLO de volta
    // Impede loop infinito com peers que respondem HELLO a cada HELLO recebido
    this._greetedSockets = new WeakSet();
  }

  // Conectar a todos os vizinhos listados no config
  connectToAll(urls) {
    for (const url of urls) {
      this.knownUrls.add(this._canonical(url));
      this._connect(url);
    }
  }

  // Abrir conexão de saída para um vizinho pelo URL
  _connect(url) {
    if (this._isOpen(url)) return;

    console.log(`[VIZINHOS] Conectando a ${url}...`);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error(`[VIZINHOS] URL inválida, ignorando: ${url} (${err.message})`);
      this.knownUrls.delete(url);
      return;
    }

    ws.on('open',    ()    => this._onOpen(ws, url));
    ws.on('message', (raw) => this._onMessage(ws, raw, url, 'outbound'));
    ws.on('close',   ()    => this._onClose(ws, url));
    ws.on('error',   (err) => console.error(`[VIZINHOS] Erro em ${url}: ${err.message}`));
  }

  // Registrar uma conexão de entrada (outro peer conectou a este nó)
  acceptIncoming(ws) {
    ws.on('message', (raw) => this._onMessage(ws, raw, null, 'inbound'));
    ws.on('close',   ()    => this._onClose(ws, null));
    ws.on('error',   (err) => console.error(`[VIZINHOS] Erro (entrada): ${err.message}`));
  }

  // --- Handlers internos ---

  _onOpen(ws, url) {
    console.log(`[VIZINHOS] Conectado a ${url}`);
    // Enviar HELLO com nossa lista de URLs conhecidos para que o vizinho
    // possa se conectar a outros peers que já conhecemos
    ws.send(JSON.stringify(buildHello(this.peerId, this._getKnownUrls())));
  }

  _onMessage(ws, raw, url, direction) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error('[VIZINHOS] Mensagem inválida (não é JSON)');
      return;
    }

    // O HELLO identifica quem está do outro lado — registrar a conexão
    if (msg.type === 'HELLO' && msg.sender_peer_id) {
      this._register(msg.sender_peer_id, ws, url, direction);

      // Conexões de entrada exigem que respondamos com HELLO uma única vez.
      // Usamos _greetedSockets para evitar loop infinito com peers que respondem
      // HELLO a cada HELLO recebido.
      if (direction === 'inbound' && !this._greetedSockets.has(ws)) {
        this._greetedSockets.add(ws);
        ws.send(JSON.stringify(buildHello(this.peerId, this._getKnownUrls())));
      }

      // Descoberta: tentar conectar aos peers que o vizinho nos informou
      if (Array.isArray(msg.peers) && msg.peers.length > 0) {
        this._discoverPeers(msg.peers);
      }
    }

    this.emit('message', msg, ws);
  }

  _onClose(ws, url) {
    // Encontrar e remover o peer que desconectou
    for (const [peerId, peer] of this.peers) {
      if (peer.ws === ws) {
        console.log(`[VIZINHOS] Desconectado: ${peerId}`);
        this.peers.delete(peerId);
        this.emit('disconnected', { peer_id: peerId, peers: this.getConnectedPeers() });
        break;
      }
    }

    // Reconectar automaticamente apenas em conexões de saída
    if (url) {
      setTimeout(() => this._connect(url), RECONNECT_DELAY_MS);
    }
  }

  _register(peerId, ws, url, direction) {
    if (peerId === this.peerId) return; // Não registrar a si mesmo

    const alreadyRegistered = this._isOpen(null, peerId);

    if (!alreadyRegistered) {
      // Novo peer: registrar no Map
      this.peers.set(peerId, { ws, url, direction });
      console.log(`[VIZINHOS] ✓ ${peerId} registrado (${direction})`);
    }
    // (HELLO duplicado — não logar para não poluir o console)

    // Sempre emitir 'connected' para manter a UI sincronizada
    this.emit('connected', { peer_id: peerId, peers: this.getConnectedPeers() });
  }

  // Processar lista de peers recebida via HELLO e conectar nos novos
  _discoverPeers(peerUrls) {
    for (const rawUrl of peerUrls) {
      const url = this._normalizeUrl(rawUrl);
      if (!url) continue;
      const canonical = this._canonical(url);
      if (this.knownUrls.has(canonical)) continue; // já conhecemos

      console.log(`[VIZINHOS] 🔍 Descoberto via HELLO: ${url}`);
      this.knownUrls.add(canonical);
      this._connect(url);
    }
  }

  // Retorna a forma canônica de uma URL (sem barra final, minúsculas no host)
  _canonical(url) {
    return url.replace(/\/+$/, ''); // remove trailing slashes
  }

  // Normalizar URL: aceita tanto "192.168.1.10" quanto "ws://192.168.1.10:8080/ws/peer"
  // Também trata objetos que alguns grupos podem enviar no campo peers
  _normalizeUrl(raw) {
    if (!raw) return null;

    // Se veio um objeto, tentar extrair o endereço
    if (typeof raw === 'object') {
      raw = raw.url || raw.address || raw.host || raw.ip || null;
      if (!raw || typeof raw !== 'string') return null;
    }

    if (typeof raw !== 'string') return null;
    raw = raw.trim();
    if (!raw) return null;

    // Rejeitar entradas obviamente inválidas
    if (raw.includes('[object') || raw.includes('undefined') || raw.includes('null')) return null;
    // Rejeitar placeholders como "172.16.3.xx" ou "172.16.3.XX"
    if (/[xX]{2,}/.test(raw)) return null;
    // Rejeitar peer_ids no formato ALUNO-XX (não são endereços)
    if (/^ALUNO-/i.test(raw)) return null;

    // Já é URL WebSocket completa — ainda verificar se o host é válido
    if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
      // Rejeitar hosts inválidos mesmo em URLs completas
      if (/\/\/ALUNO-/i.test(raw)) return null;
      if (/[xX]{2,}/.test(raw)) return null;
      return raw;
    }

    // Host puro (ex: "192.168.1.10") — montar URL padrão sem path específico
    // para interoperabilidade: o servidor aceita conexões P2P em qualquer path
    if (/^[\d.]+$/.test(raw) || /^[a-zA-Z0-9.-]+\.[a-zA-Z0-9]+$/.test(raw)) {
      return `ws://${raw}:${this.port}`;
    }

    return null;
  }


  // Retorna a lista de URLs conhecidos para incluir no HELLO
  // Inclui apenas URLs de conexões ativas (outbound com URL conhecida)
  _getKnownUrls() {
    const urls = new Set();
    for (const peer of this.peers.values()) {
      if (peer.url && peer.ws.readyState === WebSocket.OPEN) {
        urls.add(peer.url);
      }
    }
    // Incluir também os URLs configurados manualmente que conhecemos
    for (const url of this.knownUrls) {
      urls.add(url);
    }
    return [...urls];
  }

  // Verifica se já há conexão aberta para uma URL ou peerId
  _isOpen(url, peerId) {
    const canonicalUrl = url ? this._canonical(url) : null;
    for (const [id, peer] of this.peers) {
      const open = peer.ws.readyState === WebSocket.OPEN;
      if (peerId && id === peerId && open) return true;
      if (canonicalUrl && peer.url && this._canonical(peer.url) === canonicalUrl && open) return true;
    }
    // Também verificar se a URL está em processo de conexão
    if (canonicalUrl && this.knownUrls.has(canonicalUrl)) {
      for (const peer of this.peers.values()) {
        if (peer.url && this._canonical(peer.url) === canonicalUrl) return true;
      }
    }
    return false;
  }

  // --- API pública ---

  // Enviar mensagem para um peer pelo seu ID
  sendTo(peerId, msg) {
    const peer = this.peers.get(peerId);
    if (peer?.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify(msg));
      return true;
    }
    console.warn(`[VIZINHOS] Não conectado a ${peerId}`);
    return false;
  }

  // Enviar mensagem diretamente por um WebSocket (usado para roteamento reverso de SEARCH_HIT)
  sendToWs(ws, msg) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  // Adicionar vizinho em tempo de execução (via UI ou API)
  addNeighbor(url) {
    this.knownUrls.add(this._canonical(url));
    this._connect(url);
  }

  // Lista de peers atualmente conectados
  getConnectedPeers() {
    const result = [];
    for (const [peerId, peer] of this.peers) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        result.push({ peer_id: peerId, direction: peer.direction });
      }
    }
    return result;
  }

  // Fechar todas as conexões (chamado no shutdown)
  disconnectAll() {
    for (const peer of this.peers.values()) peer.ws.close();
    this.peers.clear();
  }
}

module.exports = NeighborManager;
