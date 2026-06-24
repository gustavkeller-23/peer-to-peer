// server.js — Ponto de entrada: servidor HTTP + WebSocket P2P
const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const readline = require('readline');

// ─── Configuração ─────────────────────────────────────────────────────────────

// Suporte a --config=arquivo.json e --port=XXXX na linha de comando
const configArg = process.argv.find(a => a.startsWith('--config='));
const portArg   = process.argv.find(a => a.startsWith('--port='));

const configPath = configArg ? path.resolve(configArg.split('=')[1]) : path.join(__dirname, 'config.json');
const config     = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
if (portArg) config.port = parseInt(portArg.split('=')[1]);

// Detectar IP local da máquina (primeiro IP não-loopback encontrado)
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}
config.ip = config.ip || getLocalIp();

console.log('═══════════════════════════════════════════════');
console.log(`  🎴 Sistema de Figurinhas P2P`);
console.log(`  📛 Nó:        ${config.peer_id}`);
console.log(`  🖼️  Figurinha: ${config.sticker_id}`);
console.log(`  🔌 Porta:     ${config.port}`);
console.log('═══════════════════════════════════════════════');

// ─── Módulos internos ─────────────────────────────────────────────────────────

const Inventory       = require('./src/inventory');
const NeighborManager = require('./src/neighbor-manager');
const TradeManager    = require('./src/trade-manager');
const PeerEngine      = require('./src/peer-engine');
const MessageHandler  = require('./src/message-handler');

const inventory   = new Inventory(config.sticker_id, 28);
const neighbors   = new NeighborManager(config);
const trades      = new TradeManager(config.peer_id, inventory, neighbors);
const peerEngine  = new PeerEngine(config, inventory, neighbors);

// ─── Servidor HTTP + API REST ─────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/stickers', express.static(path.join(__dirname, 'stickers')));

// Status geral do nó
app.get('/api/status', (req, res) => res.json({
  peer_id:         config.peer_id,
  sticker_id:      config.sticker_id,
  port:            config.port,
  connected_peers: neighbors.getConnectedPeers(),
  inventory:       inventory.getAll(),
  total_unique:    inventory.getTotalUnique(),
  total_count:     inventory.getTotalCount(),
}));

app.get('/api/inventory', (req, res) => res.json(inventory.getAll()));

app.get('/api/neighbors', (req, res) => res.json({
  configured: config.neighbors,
  connected:  neighbors.getConnectedPeers(),
}));

app.post('/api/neighbors', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL obrigatória' });
  _addNeighbor(url);
  res.json({ ok: true, url });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const server  = http.createServer(app);
const wssPeer = new WebSocket.Server({ noServer: true }); // conexões com outros peers
const wssUi   = new WebSocket.Server({ noServer: true }); // conexões com o browser local

// Clientes de UI conectados (pode haver mais de uma aba aberta)
const uiClients = new Set();

function notifyUi(data) {
  for (const ws of uiClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// Roteamento de mensagens recebidas de peers → módulos internos
const messageHandler = new MessageHandler(peerEngine, trades, notifyUi);
neighbors.on('message', (msg, ws) => messageHandler.handle(msg, ws));

// Repassar eventos internos para a UI usando um helper genérico
function forwardEvent(emitter, event, uiType) {
  emitter.on(event, (data) => notifyUi(JSON.stringify({ type: uiType, data })));
}

// Inventário
inventory.on('updated', (items) => {
  notifyUi(JSON.stringify({
    type: 'inventory_update',
    data: items,
    total_unique: inventory.getTotalUnique(),
    total_count:  inventory.getTotalCount(),
  }));
});

// Vizinhos
forwardEvent(neighbors, 'connected',    'neighbor_connected');
forwardEvent(neighbors, 'disconnected', 'neighbor_disconnected');

// Busca
forwardEvent(peerEngine, 'search_started',  'search_started');
forwardEvent(peerEngine, 'search_hit',      'search_hit');
forwardEvent(peerEngine, 'search_hit_sent', 'search_hit_sent');
forwardEvent(peerEngine, 'search_retry',    'search_retry');
forwardEvent(peerEngine, 'search_timeout',  'search_timeout');

// Trocas
forwardEvent(trades, 'trade_received',  'trade_received');
forwardEvent(trades, 'trade_proposed',  'trade_proposed');
forwardEvent(trades, 'trade_accepted',  'trade_accepted');
forwardEvent(trades, 'trade_rejected',  'trade_rejected');
forwardEvent(trades, 'trade_completed', 'trade_completed');
forwardEvent(trades, 'trade_confirmed', 'trade_confirmed');

// ─── Conexões WebSocket de peers (entrada) ────────────────────────────────────

wssPeer.on('connection', (ws, req) => {
  console.log(`[WS] Peer conectado de ${req.socket.remoteAddress}`);
  neighbors.acceptIncoming(ws);
});

// ─── Conexões WebSocket da UI ─────────────────────────────────────────────────

wssUi.on('connection', (ws) => {
  console.log('[UI] Browser conectado');
  uiClients.add(ws);

  // Enviar estado inicial para o browser recém-conectado
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      peer_id:        config.peer_id,
      sticker_id:     config.sticker_id,
      inventory:      inventory.getAll(),
      total_unique:   inventory.getTotalUnique(),
      total_count:    inventory.getTotalCount(),
      peers:          neighbors.getConnectedPeers(),
      pending_trades: trades.getPendingTrades(),
      trade_history:  trades.getTradeHistory(),
    },
  }));

  ws.on('message', (raw) => {
    try {
      handleUiCommand(JSON.parse(raw.toString()), ws);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
    }
  });

  ws.on('close', () => {
    console.log('[UI] Browser desconectado');
    uiClients.delete(ws);
  });
});

// Comandos enviados pelo browser via WebSocket
function handleUiCommand(cmd, ws) {
  const send = (type, data) => ws.send(JSON.stringify({ type, data }));

  switch (cmd.action) {
    case 'search': {
      if (!cmd.sticker_id) { send('error', { message: 'sticker_id obrigatório' }); break; }
      const queryId = peerEngine.search(cmd.sticker_id);
      if (queryId === null) {
        send('error', { message: `Aguarde antes de buscar ${cmd.sticker_id} novamente` });
      } else {
        send('search_initiated', { query_id: queryId, sticker_id: cmd.sticker_id });
      }
      break;
    }

    case 'get_search_results':
      send('search_results', { query_id: cmd.query_id, results: peerEngine.getSearchResults(cmd.query_id) });
      break;

    case 'trade_propose':
      try {
        trades.proposeTrade(
          cmd.target_peer_id,
          cmd.offer_sticker_id,
          cmd.want_sticker_id,
        );
        // O evento 'trade_proposed' é emitido internamente por proposeTrade()
        // e encaminhado para a UI via forwardEvent — não é necessário send() aqui.
      } catch (err) {
        send('error', { message: err.message });
      }
      break;

    case 'trade_accept':
      trades.acceptTrade(cmd.trade_id);
      break;

    case 'trade_reject':
      trades.rejectTrade(cmd.trade_id, cmd.reason);
      break;

    case 'add_neighbor':
      _addNeighbor(cmd.url);
      send('neighbor_added', { url: cmd.url });
      break;

    case 'get_status':
      send('status', {
        peer_id:        config.peer_id,
        sticker_id:     config.sticker_id,
        inventory:      inventory.getAll(),
        total_unique:   inventory.getTotalUnique(),
        total_count:    inventory.getTotalCount(),
        peers:          neighbors.getConnectedPeers(),
        pending_trades: trades.getPendingTrades(),
        trade_history:  trades.getTradeHistory(),
      });
      break;

    default:
      console.warn(`[UI] Comando desconhecido: ${cmd.action}`);
      send('error', { message: `Comando desconhecido: ${cmd.action}` });
  }
}

// ─── Roteamento de upgrade HTTP → WebSocket ────────────────────────────────────

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://localhost:${config.port}`);

  if (pathname === '/ws/ui') {
    wssUi.handleUpgrade(req, socket, head, (ws) => wssUi.emit('connection', ws, req));
  } else {
    // Toda outra rota WebSocket é tratada como conexão P2P
    wssPeer.handleUpgrade(req, socket, head, (ws) => wssPeer.emit('connection', ws, req));
  }
});

// ─── Inicialização ────────────────────────────────────────────────────────────

server.listen(config.port, () => {
  console.log(`\n🌐 Interface:      http://localhost:${config.port}`);
  console.log(`🔗 WebSocket P2P:  ws://localhost:${config.port}/ws/peer`);
  console.log(`🖥️  WebSocket UI:   ws://localhost:${config.port}/ws/ui`);
  console.log(`\n📋 Inventário inicial:`, inventory.getAll());

  if (config.neighbors?.length > 0) {
    console.log(`\n🔄 Conectando a ${config.neighbors.length} vizinhos...`);
    neighbors.connectToAll(config.neighbors);
  } else {
    console.log('\n⚠️  Nenhum vizinho configurado. Adicione via interface ou config.json');
  }

  console.log('\n✅ Sistema pronto!\n');
});

// ─── Encerramento limpo (Ctrl+C / SIGTERM) ──────────────────────────────────

function shutdown(signal) {
  console.log(`\n🛑 Recebido ${signal} — encerrando...`);

  // 1. Desconectar todos os peers (fecha os WebSockets de saída)
  neighbors.disconnectAll();

  // 2. Fechar os servidores WebSocket (encerra conexões ainda abertas)
  wssPeer.close();
  wssUi.close();

  // 3. Fechar o servidor HTTP e sair
  server.close(() => {
    console.log('✅ Servidor encerrado.');
    process.exit(0);
  });

  // 4. Forçar saída após 2s caso alguma conexão não feche a tempo
  setTimeout(() => {
    console.log('⏱️  Forçando encerramento após timeout.');
    process.exit(0);
  }, 2000).unref(); // .unref() não bloqueia o event loop
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// No Windows, Ctrl+C via npm/PowerShell não sempre gera SIGINT no processo filho.
// Usar readline é o padrão recomendado para garantir a captura do Ctrl+C.
if (process.platform === 'win32') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => process.emit('SIGINT'));
  // SIGBREAK é disparado por Ctrl+Break no Windows
  process.on('SIGBREAK', () => shutdown('SIGBREAK'));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _addNeighbor(url) {
  neighbors.addNeighbor(url);
  // Persistir no config.json para que o vizinho seja reconectado no próximo start
  if (!config.neighbors.includes(url)) {
    config.neighbors.push(url);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
}
