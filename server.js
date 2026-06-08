const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

// ── WebSocket layers ──────────────────────────────────────────────────────────
// Detecta automaticamente se wsServer/wsClient estão em websocket/ ou na raiz
const fs = require('fs');
const wsServerPath = fs.existsSync('./websocket/inBoundHandler.js')  ? './websocket/inBoundHandler'  : './inBoundHandler';
const wsClientPath = fs.existsSync('./websocket/outBoundHandler.js') ? './websocket/outBoundHandler' : './outBoundHandler';
const wsServerModule = require(wsServerPath);
const wsClientModule = require(wsClientPath);

const {
    wss, inventory, processedQueries,
    connectedPeers, MY_PEER_ID, buildInventorySummary
} = wsServerModule;

const {
    connectToPeer, sendSearch,
    sendTradeOffer, sendTransferConfirm, broadcastSearch
} = wsClientModule;

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve o front-end estático
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// ── SSE: envia eventos em tempo real para o front-end ─────────────────────────
const sseClients = new Set();

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
        res.write(payload);
    }
}

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.add(res);

    // Envia estado inicial
    res.write(`event: inventory\ndata: ${JSON.stringify(buildInventorySummary())}\n\n`);
    res.write(`event: peers\ndata: ${JSON.stringify(Array.from(connectedPeers.keys()))}\n\n`);

    req.on('close', () => sseClients.delete(res));
});

// ── Estado das negociações ────────────────────────────────────────────────────
const pendingTrades = new Map(); // query_id -> { sticker_id, offered, socket, status }

// ── Callbacks do wsClient ─────────────────────────────────────────────────────
const wsClientCallbacks = {

    onHello(msg) {
        console.log(`[server] HELLO de ${msg.peer_id}`);
        broadcast('peers', Array.from(connectedPeers.keys()));
        broadcast('log', { text: `🤝 Peer ${msg.peer_id} conectado` });
    },

    onSearchHit(msg, socket) {
        const { query_id, sticker_id, peer_id } = msg;
        broadcast('log', { text: `✅ ${sticker_id} encontrada em ${peer_id}` });
        broadcast('search_hit', msg);

        const offeredSticker = findStickerToOffer(sticker_id);
        if (!offeredSticker) {
            broadcast('log', { text: `⚠️ Sem figurinhas para oferecer em troca de ${sticker_id}` });
            return;
        }

        pendingTrades.set(query_id, {
            sticker_id, offered_sticker_id: offeredSticker,
            peerSocket: socket, status: 'awaiting_accept'
        });

        sendTradeOffer(socket, query_id, sticker_id, offeredSticker);
        broadcast('log', { text: `🔄 Oferta enviada: ${offeredSticker} por ${sticker_id}` });
    },

    onSearchMiss(msg) {
        broadcast('log', { text: `❌ ${msg.sticker_id} não encontrada em ${msg.peer_id}` });
        broadcast('search_miss', msg);
    },

    onTradeAccept(msg, socket) {
        const { query_id, sticker_id, offered_sticker_id } = msg;
        const trade = pendingTrades.get(query_id);
        if (!trade) return;

        trade.status = 'confirmed';
        sendTransferConfirm(socket, query_id, offered_sticker_id, sticker_id);

        // Atualiza inventário local
        if (inventory[offered_sticker_id]?.quantity > 0) inventory[offered_sticker_id].quantity--;
        if (inventory[sticker_id])                       inventory[sticker_id].quantity++;

        pendingTrades.delete(query_id);
        broadcast('log', { text: `🎉 Troca concluída! Recebi ${sticker_id}, enviei ${offered_sticker_id}` });
        broadcast('inventory', buildInventorySummary());
    },

    onTradeReject(msg) {
        broadcast('log', { text: `🚫 Troca rejeitada por ${msg.peer_id}: ${msg.reason}` });
        pendingTrades.delete(msg.query_id);
    },

    onTransferConfirm(msg) {
        broadcast('log', { text: `📦 Transferência confirmada por ${msg.peer_id}` });
    }
};

// ── Eventos emitidos pelo wsServer ────────────────────────────────────────────
wss.on('trade_accepted', (msg) => {
    broadcast('log', { text: `✅ Peer aceitou nossa oferta` });
});

wss.on('transfer_confirmed', (msg) => {
    broadcast('inventory', buildInventorySummary());
    broadcast('log', { text: `🔄 Inventário atualizado após transferência` });
});

wss.on('peer_connected', (peerId) => {
    broadcast('peers', Array.from(connectedPeers.keys()));
    broadcast('log', { text: `🌐 Novo peer conectado: ${peerId}` });
});

wss.on('peer_disconnected', (peerId) => {
    broadcast('peers', Array.from(connectedPeers.keys()));
    broadcast('log', { text: `👋 Peer desconectado: ${peerId}` });
});

// ── REST API ──────────────────────────────────────────────────────────────────

/** GET /inventory */
app.get('/inventory', (req, res) => {
    res.json({ peer_id: MY_PEER_ID, inventory: buildInventorySummary() });
});

/** GET /peers */
app.get('/peers', (req, res) => {
    res.json({ peers: Array.from(connectedPeers.keys()) });
});

/** POST /connect — conecta a um peer remoto */
app.post('/connect', (req, res) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'address obrigatório' });

    try {
        connectToPeer(address, wsClientCallbacks);
        res.json({ message: `Conectando a ${address}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** POST /search — busca uma figurinha na rede */
app.post('/search', (req, res) => {
    const { sticker_id } = req.body;
    if (!sticker_id) return res.status(400).json({ error: 'sticker_id obrigatório' });

    if (inventory[sticker_id]?.quantity > 0) {
        return res.json({ message: `Você já possui ${sticker_id}`, already_have: true });
    }

    const query_id = broadcastSearch(sticker_id);
    broadcast('log', { text: `🔍 Buscando ${sticker_id} na rede... (${query_id.slice(0,8)})` });
    res.json({ message: 'Busca iniciada', query_id, sticker_id });
});

/** POST /trade — oferta manual de troca */
app.post('/trade', (req, res) => {
    const { peer_id, sticker_id, offered_sticker_id } = req.body;
    if (!peer_id || !sticker_id || !offered_sticker_id)
        return res.status(400).json({ error: 'peer_id, sticker_id e offered_sticker_id obrigatórios' });

    const socket = connectedPeers.get(peer_id);
    if (!socket) return res.status(404).json({ error: `Peer ${peer_id} não conectado` });

    const query_id = uuidv4();
    sendTradeOffer(socket, query_id, sticker_id, offered_sticker_id);
    broadcast('log', { text: `🔄 Oferta manual enviada para ${peer_id}` });
    res.json({ message: 'Oferta enviada', query_id });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function findStickerToOffer(wantedSticker) {
    // Não oferecer a mesma figurinha que está sendo pedida
    for (const [id, data] of Object.entries(inventory)) {
        if (id !== wantedSticker && data.quantity > 1) return id;
    }
    // Caso só tenha FIG-12 com muitas cópias
    if (inventory['FIG-12']?.quantity > 1) return 'FIG-12';
    return null;
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`[server] HTTP/Front-end → http://localhost:${PORT}`);
    console.log(`[server] WebSocket peers → ws://localhost:8080`);
    console.log(`[server] Peer ID: ${MY_PEER_ID}`);
});