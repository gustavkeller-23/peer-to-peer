/**
 * Sistema de Figurinhas P2P - ALUNO-12 / FIG-12
 * Servidor Node.js com WebSocket
 *
 * Dependências: ws, uuid
 * Uso: node server.js [porta] [peer_id]
 *   Exemplo: node server.js 8080 ALUNO-12
 *   Exemplo: node server.js 8080 usuario@email.com
 *   Exemplo: node server.js 8080 MeuNome
 */

const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Configuração do nó ───────────────────────────────────────────────────────
const PORT = parseInt(process.argv[2]) || 8080;

// PEER_ID agora aceita qualquer tipo de conta: ALUNO-XX, email, username, hostname, etc.
const PEER_ID = process.argv[3] || "ALUNO-12";

// Gera MY_STICKER_ID de forma segura para qualquer formato de PEER_ID
function deriveStickerIdFromPeerId(peerId) {
    // Se no formato ALUNO-XX, usa FIG-XX
    const match = peerId.match(/^[A-Za-z]+-(\d+)$/);
    if (match) return `FIG-${match[1]}`;
    // Caso contrário, usa hash simples do nome
    let hash = 0;
    for (const c of peerId) hash = (hash * 31 + c.charCodeAt(0)) % 100;
    return `FIG-${String(hash).padStart(2, "0")}`;
}

const MY_STICKER_ID = deriveStickerIdFromPeerId(PEER_ID);
const DEFAULT_TTL = 7;
const INITIAL_STICKER_COPIES = 28;

// ─── Arquivo de persistência ──────────────────────────────────────────────────
const INVENTORY_FILE = path.join(__dirname, "inventory.json");

// Descobre automaticamente o IP da máquina na rede local
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}

const LOCAL_IP = "26.238.224.67"; // getLocalIP();

// ─── Clientes do frontend (declarado cedo para uso no log) ───────────────────
const frontendClients = new Set();

// ─── Estado do nó ────────────────────────────────────────────────────────────
const state = {
    inventory: {},           // { "FIG-12": 28, "FIG-05": 2, ... }
    neighbors: {},           // { peer_id: { ws, ip, port, account } }
    seenQueryIds: new Set(), // query_ids de SEARCH já vistos (anti-loop)
    seenMsgIds: new Set(),   // message_ids de TRADE já vistos (anti-loop)
    pendingTrades: {},       // { message_id: { offer, want, from_peer_id } }
    searchHistory: [],       // log de buscas
    tradeHistory: [],        // log de trocas
    messages: [],            // log de mensagens P2P (HELLO, SEARCH, TRADE, etc.)
};

// ─── Persistência JSON ────────────────────────────────────────────────────────

/**
 * Carrega o estado persistido do inventory.json.
 * O arquivo armazena: inventory, peers (vizinhos conhecidos), mensagens históricas.
 */
function loadPersistedState() {
    try {
        if (!fs.existsSync(INVENTORY_FILE)) {
            log("PERSIST", "inventory.json não encontrado, iniciando com estado padrão");
            return;
        }
        const raw = fs.readFileSync(INVENTORY_FILE, "utf-8").trim();
        if (!raw) return;
        const data = JSON.parse(raw);

        // Restaura inventário (mescla: mantém o padrão inicial se não havia nada salvo)
        if (data.inventory && typeof data.inventory === "object") {
            Object.assign(state.inventory, data.inventory);
            log("PERSIST", `Inventário restaurado: ${Object.keys(state.inventory).length} figurinhas`);
        }

        // Restaura histórico de mensagens
        if (Array.isArray(data.messages)) {
            state.messages = data.messages.slice(-200); // máximo 200 mensagens
            log("PERSIST", `Mensagens restauradas: ${state.messages.length}`);
        }

        // Restaura histórico de trocas
        if (Array.isArray(data.tradeHistory)) {
            state.tradeHistory = data.tradeHistory.slice(-100);
            log("PERSIST", `Histórico de trocas restaurado: ${state.tradeHistory.length}`);
        }

        // Restaura histórico de buscas
        if (Array.isArray(data.searchHistory)) {
            state.searchHistory = data.searchHistory.slice(-100);
            log("PERSIST", `Histórico de buscas restaurado: ${state.searchHistory.length}`);
        }

        log("PERSIST", "Estado restaurado com sucesso do inventory.json");
    } catch (e) {
        log("ERR", `Erro ao carregar inventory.json: ${e.message}`);
    }
}

/**
 * Salva o estado atual no inventory.json.
 * Inclui: inventário, peers conhecidos (sem WebSocket), mensagens e históricos.
 */
function persistState() {
    try {
        // Serializa peers conhecidos (sem referências WebSocket)
        const peersSnapshot = {};
        for (const [pid, n] of Object.entries(state.neighbors)) {
            peersSnapshot[pid] = {
                ip: n.ip,
                port: n.port,
                account: n.account || pid,
                lastSeen: n.lastSeen || new Date().toISOString(),
            };
        }

        const data = {
            meta: {
                peerId: PEER_ID,
                myStickerId: MY_STICKER_ID,
                savedAt: new Date().toISOString(),
                version: "1.1.0",
            },
            inventory: state.inventory,
            peers: peersSnapshot,
            messages: state.messages.slice(-200),
            searchHistory: state.searchHistory.slice(-100),
            tradeHistory: state.tradeHistory.slice(-100),
        };

        fs.writeFileSync(INVENTORY_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.error("Erro ao persistir estado:", e.message);
    }
}

// Salva com debounce para não sobrecarregar I/O
let persistTimer = null;
function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistState, 500);
}

/**
 * Registra uma mensagem P2P no histórico de mensagens para persistência.
 */
function recordMessage(direction, msgType, peerId, details = {}) {
    const entry = {
        ts: new Date().toISOString(),
        direction,   // "IN" ou "OUT"
        type: msgType,
        peer: peerId,
        ...details,
    };
    state.messages.push(entry);
    if (state.messages.length > 500) state.messages = state.messages.slice(-200);
    schedulePersist();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function log(tag, msg, data = "") {
    const ts = new Date().toISOString().substring(11, 23);
    console.log(`[${ts}] [${tag}] ${msg}`, data ? JSON.stringify(data) : "");
    broadcastToFrontend({ type: "LOG", tag, msg, data, ts });
}

function send(ws, obj) {
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
        }
    } catch (e) {
        console.error("Erro ao enviar:", e.message);
    }
}

function broadcastToFrontend(msg) {
    frontendClients.forEach((ws) => send(ws, msg));
}

function pushStateToFrontend() {
    broadcastToFrontend({
        type: "STATE_UPDATE",
        peerId: PEER_ID,
        myStickerId: MY_STICKER_ID,
        inventory: state.inventory,
        neighbors: Object.entries(state.neighbors).map(([id, n]) => ({
            peer_id: id,
            ip: n.ip,
            port: n.port,
            account: n.account || id,
            connected: n.ws?.readyState === WebSocket.OPEN,
        })),
        searchHistory: state.searchHistory.slice(-50),
        tradeHistory: state.tradeHistory.slice(-50),
        messages: state.messages.slice(-50),
    });
}

// ─── Inicializa estado ────────────────────────────────────────────────────────

// Inventário inicial: 28 cópias da própria figurinha (antes de carregar persistido)
state.inventory[MY_STICKER_ID] = INITIAL_STICKER_COPIES;

// Carrega estado persistido (pode sobrescrever o inventário inicial)
loadPersistedState();

// Garante que a própria figurinha sempre existe no inventário
if (!state.inventory[MY_STICKER_ID]) {
    state.inventory[MY_STICKER_ID] = INITIAL_STICKER_COPIES;
}

// ─── Servidores ───────────────────────────────────────────────────────────────

// ─── Mapa de MIME types ──────────────────────────────────────────────────────
const MIME = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
};

// HTTP server para servir o frontend e a API REST
const httpServer = http.createServer((req, res) => {
    // Adiciona CORS para desenvolvimento
    res.setHeader("Access-Control-Allow-Origin", "*");

    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = url.pathname;

    // API: inventário completo
    if (pathname === "/api/inventory") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
            peerId: PEER_ID,
            myStickerId: MY_STICKER_ID,
            inventory: state.inventory,
        }));
    }

    // API: peers conhecidos
    if (pathname === "/api/peers") {
        res.writeHead(200, { "Content-Type": "application/json" });
        const peers = Object.entries(state.neighbors).map(([id, n]) => ({
            peer_id: id,
            ip: n.ip,
            port: n.port,
            account: n.account || id,
            connected: n.ws?.readyState === WebSocket.OPEN,
            lastSeen: n.lastSeen,
        }));
        return res.end(JSON.stringify({ peers }));
    }

    // API: histórico de mensagens
    if (pathname === "/api/messages") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ messages: state.messages.slice(-100) }));
    }

    // API: snapshot completo do inventory.json
    if (pathname === "/api/snapshot") {
        res.writeHead(200, { "Content-Type": "application/json" });
        try {
            const raw = fs.readFileSync(INVENTORY_FILE, "utf-8");
            return res.end(raw);
        } catch {
            return res.end(JSON.stringify({ error: "Arquivo não encontrado" }));
        }
    }

    // Rota raiz → index.html
    if (pathname === "/") pathname = "/index.html";

    // Resolve o caminho no sistema de arquivos
    const filePath = path.join(__dirname, pathname);

    // Segurança: impede path traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end(`Arquivo nao encontrado: ${pathname}`);
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
    });
});

// WebSocket server principal (protocolo P2P) - porta PORT
const p2pServer = new WebSocket.Server({ port: PORT });
log("BOOT", `Nó P2P iniciado`, { peerId: PEER_ID, myStickerId: MY_STICKER_ID, ip: LOCAL_IP, port: PORT });

// WebSocket server para o frontend - porta PORT+1
const frontendPort = PORT + 1;
const frontendServer = new WebSocket.Server({ port: frontendPort });

frontendServer.on("connection", (ws) => {
    frontendClients.add(ws);
    log("FRONTEND", "Frontend conectado");
    pushStateToFrontend();

    ws.on("message", (raw) => {
        try {
            const msg = JSON.parse(raw);
            handleFrontendCommand(msg, ws);
        } catch (e) {
            log("ERR", "Comando inválido do frontend", e.message);
        }
    });

    ws.on("close", () => frontendClients.delete(ws));
});

httpServer.listen(PORT + 2, () => {
    log("HTTP", `Frontend disponível em http://localhost:${PORT + 2}`);
});

// ─── Protocolo P2P ────────────────────────────────────────────────────────────

p2pServer.on("connection", (ws, req) => {
    const remoteIp = req.socket.remoteAddress;
    log("CONN", `Nova conexão de ${remoteIp}`);

    ws.on("message", (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return log("ERR", "JSON inválido recebido");
        }
        handleP2PMessage(msg, ws, remoteIp);
    });

    ws.on("close", () => {
        // Remove vizinho que desconectou
        for (const [pid, n] of Object.entries(state.neighbors)) {
            if (n.ws === ws) {
                log("DISCONN", `Vizinho desconectou: ${pid}`);
                // Atualiza lastSeen antes de remover a referência ws
                state.neighbors[pid].lastSeen = new Date().toISOString();
                state.neighbors[pid].ws = null;
                schedulePersist();
                pushStateToFrontend();
                break;
            }
        }
    });
});

function handleP2PMessage(msg, ws, remoteIp) {
    log("RECV", `${msg.type} de ${msg.sender_peer_id || "?"}`, msg);
    recordMessage("IN", msg.type, msg.sender_peer_id || remoteIp, {
        message_id: msg.message_id,
    });

    switch (msg.type) {
        case "HELLO":            return handleHello(msg, ws, remoteIp);
        case "SEARCH":           return handleSearch(msg, ws);
        case "SEARCH_HIT":       return handleSearchHit(msg);
        case "SEARCH_MISS":      return handleSearchMiss(msg);
        case "TRADE_OFFER":      return handleTradeOffer(msg, ws);
        case "TRADE_ACCEPT":     return handleTradeAccept(msg);
        case "TRADE_REJECT":     return handleTradeReject(msg);
        case "TRANSFER_CONFIRM": return handleTransferConfirm(msg);
        default:
            log("WARN", `Tipo desconhecido: ${msg.type}`);
    }
}

// ─── HELLO ────────────────────────────────────────────────────────────────────
// Aceita qualquer tipo de conta como sender_peer_id:
// - ALUNO-12, ALUNO-05 (formato original)
// - usuario@email.com  (endereço de email)
// - MeuNome, Alice, Bob (nomes simples)
// - 192.168.1.5        (IPs puros ainda funcionam)
// - qualquer string não vazia
function handleHello(msg, ws, remoteIp) {
    // Aceita qualquer sender_peer_id não vazio
    const pid = msg.sender_peer_id && String(msg.sender_peer_id).trim();

    if (!pid) {
        log("HELLO", "HELLO recebido sem sender_peer_id, ignorando");
        return;
    }

    // Determina o endereço de conexão:
    // Pode ser IP, hostname, username, email, etc.
    // Para conexões P2P reais, mantemos o remoteIp para o WebSocket
    // mas armazenamos o "account" (identidade) separadamente
    const peerAccount = msg.account || pid; // campo opcional "account" para endereço customizado

    if (!state.neighbors[pid]) {
        state.neighbors[pid] = {
            ws,
            ip: remoteIp,
            port: msg.port || PORT,
            account: peerAccount,
            lastSeen: new Date().toISOString(),
        };
        log("HELLO", `Novo vizinho registrado: ${pid} (conta: ${peerAccount})`);
    } else {
        // Atualiza conexão existente
        state.neighbors[pid].ws = ws;
        state.neighbors[pid].lastSeen = new Date().toISOString();
        if (msg.account) state.neighbors[pid].account = msg.account;
        log("HELLO", `Vizinho reconectado: ${pid}`);
    }

    schedulePersist();

    // Processa lista de peers que o vizinho conhece
    if (Array.isArray(msg.peers)) {
        msg.peers.forEach((peerEntry) => {
            // Peer pode ser "ip:port", "account:port", ou apenas "account"
            log("HELLO", `Peer conhecido por ${pid}: ${peerEntry}`);
        });
    }

    // Responde com HELLO contendo lista de peers conhecidos
    // Inclui tanto endereço IP quanto account para compatibilidade
    const reply = {
        type: "HELLO",
        message_id: uuidv4(),
        sender_peer_id: PEER_ID,
        account: PEER_ID,          // identidade da conta (pode ser email, username, etc.)
        port: PORT,
        peers: Object.entries(state.neighbors)
            .filter(([id]) => id !== pid)
            .map(([id, n]) => ({
                peer_id: id,
                account: n.account || id,
                ip: n.ip,
                port: n.port || PORT,
                // Compatibilidade com formato legado "ip:port"
                address: `${n.ip}:${n.port || PORT}`,
            })),
    };
    send(ws, reply);

    recordMessage("OUT", "HELLO", pid, { account: peerAccount });
    pushStateToFrontend();
}

// SEARCH
function handleSearch(msg, ws) {
    const { query_id, sticker_id, ttl, origin_peer_id, sender_peer_id } = msg;

    // Ignora duplicata
    if (state.seenQueryIds.has(query_id)) {
        return log("SEARCH", `Duplicata ignorada: ${query_id}`);
    }
    state.seenQueryIds.add(query_id);

    const stickerKey = sticker_id.replace(/\.PNG$/i, "");

    const entry = {
        ts: new Date().toISOString(),
        query_id,
        sticker_id: stickerKey,
        origin: origin_peer_id,
        ttl,
        found: false,
    };

    // Verifica inventário local
    if (state.inventory[stickerKey] && state.inventory[stickerKey] > 0) {
        entry.found = true;
        log("SEARCH", `Figurinha ${stickerKey} encontrada! Enviando SEARCH_HIT para ${origin_peer_id}`);

        const hit = {
            type: "SEARCH_HIT",
            message_id: uuidv4(),
            origin_peer_id: PEER_ID,
            sender_peer_id: PEER_ID,
            receiver_peer_id: origin_peer_id,
            query_id,
            sticker_id: stickerKey,
        };

        // Envia SEARCH_HIT diretamente ao originador se for vizinho
        const targetWs = state.neighbors[origin_peer_id]?.ws || ws;
        send(targetWs, hit);
        recordMessage("OUT", "SEARCH_HIT", origin_peer_id, { sticker_id: stickerKey, query_id });
    } else {
        // Repassa busca com TTL-1 se ainda houver alcance
        if (ttl > 1) {
            const forward = {
                ...msg,
                message_id: uuidv4(),
                sender_peer_id: PEER_ID,
                ttl: ttl - 1,
            };

            let forwarded = 0;
            for (const [pid, n] of Object.entries(state.neighbors)) {
                if (pid !== sender_peer_id && n.ws?.readyState === WebSocket.OPEN) {
                    forward.receiver_peer_id = pid;
                    send(n.ws, { ...forward });
                    forwarded++;
                }
            }
            log("SEARCH", `Repassado para ${forwarded} vizinhos (ttl=${ttl - 1})`);
        } else {
            log("SEARCH", `TTL zerado, busca encerrada`);
        }
    }

    state.searchHistory.push(entry);
    schedulePersist();
    pushStateToFrontend();
}

// SEARCH_HIT
function handleSearchHit(msg) {
    log("SEARCH_HIT", `${msg.sticker_id} encontrada em ${msg.origin_peer_id}`);
    state.searchHistory.push({
        ts: new Date().toISOString(),
        type: "HIT",
        sticker_id: msg.sticker_id,
        found_at: msg.origin_peer_id,
        query_id: msg.query_id,
    });
    recordMessage("IN", "SEARCH_HIT", msg.origin_peer_id, {
        sticker_id: msg.sticker_id,
        query_id: msg.query_id,
    });
    broadcastToFrontend({ type: "SEARCH_RESULT", hit: true, msg });
    schedulePersist();
    pushStateToFrontend();
}

// SEARCH_MISS
function handleSearchMiss(msg) {
    log("SEARCH_MISS", `${msg.sticker_id} não encontrada`);
    recordMessage("IN", "SEARCH_MISS", msg.origin_peer_id || "?", {
        sticker_id: msg.sticker_id,
    });
    broadcastToFrontend({ type: "SEARCH_RESULT", hit: false, msg });
}

// ─── Flooding genérico para mensagens de Trade ───────────────────────────────
/**
 * Encaminha uma mensagem de trade para todos os vizinhos conectados,
 * exceto o peer de quem veio (sender_peer_id).
 * Decrementa TTL antes de repassar.
 * @returns {number} quantidade de peers para quem foi repassada
 */
function floodTrade(msg, excludePeerId) {
    if ((msg.ttl || 1) <= 1) {
        log("FLOOD", `TTL zerado, mensagem ${msg.type} descartada`);
        return 0;
    }
    const forward = {
        ...msg,
        message_id: uuidv4(),
        sender_peer_id: PEER_ID,
        ttl: (msg.ttl || 2) - 1,
    };
    let forwarded = 0;
    for (const [pid, n] of Object.entries(state.neighbors)) {
        if (pid !== excludePeerId && n.ws?.readyState === WebSocket.OPEN) {
            send(n.ws, { ...forward, receiver_peer_id: pid });
            forwarded++;
        }
    }
    log("FLOOD", `${msg.type} repassado para ${forwarded} vizinhos (ttl→${forward.ttl})`);
    return forwarded;
}

// TRADE_OFFER — flooding por TTL
// Se eu sou o destinatário → processa localmente (notifica frontend).
// Caso contrário → repassa para todos os vizinhos exceto quem enviou.
function handleTradeOffer(msg, senderWs) {
    const { message_id, offer_sticker_id, want_sticker_id, origin_peer_id, receiver_peer_id, sender_peer_id } = msg;

    // Anti-loop: ignora mensagem já vista
    if (state.seenMsgIds.has(message_id)) {
        return log("TRADE", `TRADE_OFFER duplicado ignorado: ${message_id}`);
    }
    state.seenMsgIds.add(message_id);

    // Sou o destinatário?
    if (receiver_peer_id === PEER_ID) {
        log("TRADE", `Oferta recebida de ${origin_peer_id}: oferece ${offer_sticker_id}, quer ${want_sticker_id}`);
        state.pendingTrades[message_id] = {
            offer: offer_sticker_id,
            want: want_sticker_id,
            from_peer_id: origin_peer_id,
            original_msg: msg,
        };
        recordMessage("IN", "TRADE_OFFER", origin_peer_id, { offer: offer_sticker_id, want: want_sticker_id, message_id });
        broadcastToFrontend({ type: "TRADE_OFFER_RECEIVED", msg });
        pushStateToFrontend();
        return;
    }

    // Não sou o destinatário → verifica se tenho rota direta ou inunda
    const directWs = receiver_peer_id ? state.neighbors[receiver_peer_id]?.ws : null;
    if (directWs && directWs.readyState === WebSocket.OPEN) {
        // Rota direta conhecida — entrega direto
        const forward = { ...msg, message_id: uuidv4(), sender_peer_id: PEER_ID, ttl: (msg.ttl || 2) - 1 };
        send(directWs, forward);
        log("TRADE", `TRADE_OFFER roteado diretamente para ${receiver_peer_id}`);
    } else {
        // Inunda para todos os vizinhos (exceto quem enviou)
        floodTrade(msg, sender_peer_id);
    }
}

// TRADE_ACCEPT — flooding de volta ao origin_peer_id do accept
// Quem aceita envia com receiver_peer_id = quem fez a oferta original.
function handleTradeAccept(msg) {
    const { message_id, receiver_peer_id, origin_peer_id, sender_peer_id } = msg;

    if (state.seenMsgIds.has(message_id)) {
        return log("TRADE", `TRADE_ACCEPT duplicado ignorado: ${message_id}`);
    }
    state.seenMsgIds.add(message_id);

    // Sou o destinatário?
    if (receiver_peer_id === PEER_ID) {
        log("TRADE", `Troca aceita por ${origin_peer_id}`);
        recordMessage("IN", "TRADE_ACCEPT", origin_peer_id, {
            offer: msg.offer_sticker_id,
            want: msg.want_sticker_id,
        });
        broadcastToFrontend({ type: "TRADE_ACCEPTED", msg });

        // Envia TRANSFER_CONFIRM de volta via flood
        const confirm = {
            type: "TRANSFER_CONFIRM",
            message_id: uuidv4(),
            origin_peer_id: PEER_ID,
            sender_peer_id: PEER_ID,
            receiver_peer_id: origin_peer_id,
            offer_sticker_id: msg.want_sticker_id,  // o que o outro ofereceu
            want_sticker_id:  msg.offer_sticker_id,  // o que eu queria
            ttl: DEFAULT_TTL,
        };
        const directWs = state.neighbors[origin_peer_id]?.ws;
        if (directWs && directWs.readyState === WebSocket.OPEN) {
            send(directWs, confirm);
        } else {
            floodTrade(confirm, null);
        }
        recordMessage("OUT", "TRANSFER_CONFIRM", origin_peer_id, {
            give: confirm.offer_sticker_id,
            receive: confirm.want_sticker_id,
        });
        applyInventoryUpdate(confirm.offer_sticker_id, -1, confirm.want_sticker_id, +1);
        return;
    }

    // Não sou o destinatário → roteia ou inunda
    const directWs = receiver_peer_id ? state.neighbors[receiver_peer_id]?.ws : null;
    if (directWs && directWs.readyState === WebSocket.OPEN) {
        const forward = { ...msg, message_id: uuidv4(), sender_peer_id: PEER_ID, ttl: (msg.ttl || 2) - 1 };
        send(directWs, forward);
        log("TRADE", `TRADE_ACCEPT roteado diretamente para ${receiver_peer_id}`);
    } else {
        floodTrade(msg, sender_peer_id);
    }
}

// TRADE_REJECT — flooding de volta ao origin_peer_id
function handleTradeReject(msg) {
    const { message_id, receiver_peer_id, origin_peer_id, sender_peer_id } = msg;

    if (state.seenMsgIds.has(message_id)) {
        return log("TRADE", `TRADE_REJECT duplicado ignorado: ${message_id}`);
    }
    state.seenMsgIds.add(message_id);

    if (receiver_peer_id === PEER_ID) {
        log("TRADE", `Troca rejeitada por ${origin_peer_id}`);
        recordMessage("IN", "TRADE_REJECT", origin_peer_id || "?", {});
        broadcastToFrontend({ type: "TRADE_REJECTED", msg });
        return;
    }

    const directWs = receiver_peer_id ? state.neighbors[receiver_peer_id]?.ws : null;
    if (directWs && directWs.readyState === WebSocket.OPEN) {
        const forward = { ...msg, message_id: uuidv4(), sender_peer_id: PEER_ID, ttl: (msg.ttl || 2) - 1 };
        send(directWs, forward);
    } else {
        floodTrade(msg, sender_peer_id);
    }
}

// TRANSFER_CONFIRM — flooding até o destinatário
function handleTransferConfirm(msg) {
    const { message_id, receiver_peer_id, origin_peer_id, sender_peer_id } = msg;

    if (state.seenMsgIds.has(message_id)) {
        return log("TRANSFER", `TRANSFER_CONFIRM duplicado ignorado: ${message_id}`);
    }
    state.seenMsgIds.add(message_id);

    if (receiver_peer_id === PEER_ID) {
        log("TRANSFER", `Confirmação de transferência de ${origin_peer_id}`);
        recordMessage("IN", "TRANSFER_CONFIRM", origin_peer_id, {
            give: msg.want_sticker_id,
            receive: msg.offer_sticker_id,
        });
        applyInventoryUpdate(msg.want_sticker_id, -1, msg.offer_sticker_id, +1);
        broadcastToFrontend({ type: "TRANSFER_DONE", msg });
        pushStateToFrontend();
        return;
    }

    const directWs = receiver_peer_id ? state.neighbors[receiver_peer_id]?.ws : null;
    if (directWs && directWs.readyState === WebSocket.OPEN) {
        const forward = { ...msg, message_id: uuidv4(), sender_peer_id: PEER_ID, ttl: (msg.ttl || 2) - 1 };
        send(directWs, forward);
    } else {
        floodTrade(msg, sender_peer_id);
    }
}

function applyInventoryUpdate(give, giveDelta, receive, receiveDelta) {
    if (!state.inventory[give]) state.inventory[give] = 0;
    if (!state.inventory[receive]) state.inventory[receive] = 0;

    state.inventory[give] = Math.max(0, state.inventory[give] + giveDelta);
    state.inventory[receive] = Math.max(0, state.inventory[receive] + receiveDelta);

    state.tradeHistory.push({
        ts: new Date().toISOString(),
        gave: give,
        received: receive,
        inventory: { ...state.inventory },
    });

    log("INVENTORY", `Inventário atualizado`, state.inventory);
    schedulePersist();
    pushStateToFrontend();
}

// ─── Comandos do Frontend ────────────────────────────────────────────────────

function handleFrontendCommand(cmd, ws) {
    log("CMD", `Comando do frontend: ${cmd.type}`, cmd);

    switch (cmd.type) {
        case "CONNECT_PEER":  return cmdConnectPeer(cmd);
        case "SEARCH":        return cmdSearch(cmd);
        case "TRADE_OFFER":   return cmdTradeOffer(cmd);
        case "TRADE_ACCEPT":  return cmdTradeAccept(cmd);
        case "TRADE_REJECT":  return cmdTradeReject(cmd);
        case "GET_STATE":     return pushStateToFrontend();
        default:
            log("WARN", `Comando desconhecido: ${cmd.type}`);
    }
}

/**
 * Conecta a um peer.
 * Aceita qualquer tipo de conta no campo peer_id:
 * - "ALUNO-12"
 * - "usuario@email.com"
 * - "Alice"
 * O campo ip é o endereço real de conexão WebSocket.
 * Se ip não for fornecido mas peer_id parecer um hostname/IP, tenta usar como ip.
 */
function cmdConnectPeer(cmd) {
    const { ip, port, peer_id } = cmd;
    const targetPort = parseInt(port) || PORT;

    // Tenta resolver o endereço de conexão:
    // 1. ip explícito (preferido)
    // 2. peer_id como hostname/IP (fallback)
    let connectAddr = ip && ip.trim();
    if (!connectAddr && peer_id) {
        // Tenta usar peer_id como endereço se parecer um IP ou hostname
        const isAddress = /^[\d.]+$/.test(peer_id) || // IPv4
                          /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(peer_id); // hostname
        if (isAddress) connectAddr = peer_id;
    }

    if (!connectAddr) {
        log("ERR", `Endereço de conexão não fornecido para ${peer_id || "?"}`);
        broadcastToFrontend({ type: "ERROR", msg: "Digite o endereço IP ou hostname do peer" });
        return;
    }

    log("CONNECT", `Conectando a ${peer_id || "?"} em ${connectAddr}:${targetPort}`);

    const peerWs = new WebSocket(`ws://${connectAddr}:${targetPort}`);

    // ID provisório para rastrear antes do HELLO de resposta
    const tempId = peer_id || `PEER-${Date.now()}`;

    peerWs.on("open", () => {
        const hello = {
            type: "HELLO",
            message_id: uuidv4(),
            sender_peer_id: PEER_ID,
            account: PEER_ID,   // conta/identidade (qualquer formato)
            port: PORT,
            peers: Object.entries(state.neighbors)
                .filter(([, n]) => n.ws?.readyState === WebSocket.OPEN)
                .map(([id, n]) => ({
                    peer_id: id,
                    account: n.account || id,
                    ip: n.ip,
                    port: n.port || PORT,
                    address: `${n.ip}:${n.port || PORT}`,
                })),
        };
        send(peerWs, hello);
        recordMessage("OUT", "HELLO", tempId, { account: PEER_ID, address: `${connectAddr}:${targetPort}` });

        // Registra vizinho com ID provisório
        state.neighbors[tempId] = {
            ws: peerWs,
            ip: connectAddr,
            port: targetPort,
            account: peer_id || tempId,
            lastSeen: new Date().toISOString(),
        };
        schedulePersist();
        pushStateToFrontend();
    });

    peerWs.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // Se for HELLO de resposta, atualiza peer_id com o real
        if (msg.type === "HELLO" && msg.sender_peer_id) {
            const realId = msg.sender_peer_id;
            if (realId !== tempId && state.neighbors[tempId]) {
                // Migra para o ID real
                state.neighbors[realId] = {
                    ...state.neighbors[tempId],
                    account: msg.account || realId,
                };
                delete state.neighbors[tempId];
                schedulePersist();
            }
        }
        handleP2PMessage(msg, peerWs, connectAddr);
    });

    peerWs.on("error", (e) => {
        log("ERR", `Erro ao conectar em ${connectAddr}:${targetPort}: ${e.message}`);
        broadcastToFrontend({ type: "ERROR", msg: `Falha ao conectar: ${e.message}` });
    });

    peerWs.on("close", () => {
        log("DISCONN", `Conexão encerrada com ${connectAddr}:${targetPort}`);
        for (const [pid, n] of Object.entries(state.neighbors)) {
            if (n.ip === connectAddr && n.port === targetPort) {
                state.neighbors[pid].lastSeen = new Date().toISOString();
                state.neighbors[pid].ws = null;
                schedulePersist();
                break;
            }
        }
        pushStateToFrontend();
    });
}

function cmdSearch(cmd) {
    const { sticker_id } = cmd;
    const query_id = uuidv4();

    const msg = {
        type: "SEARCH",
        message_id: uuidv4(),
        origin_peer_id: PEER_ID,
        origin_peer_ip: LOCAL_IP,
        sender_peer_id: PEER_ID,
        receiver_peer_id: null,
        query_id,
        ttl: DEFAULT_TTL,
        sticker_id: sticker_id.toUpperCase().replace(/\.PNG$/i, "") + ".PNG",
    };

    // Registra como já visto para não processar de volta
    state.seenQueryIds.add(query_id);

    log("SEARCH", `Iniciando busca por ${sticker_id}`, { query_id });

    let sent = 0;
    for (const [pid, n] of Object.entries(state.neighbors)) {
        if (n.ws?.readyState === WebSocket.OPEN) {
            send(n.ws, { ...msg, receiver_peer_id: pid });
            sent++;
        }
    }

    if (sent === 0) {
        log("SEARCH", "Nenhum vizinho conectado para buscar");
        broadcastToFrontend({ type: "SEARCH_RESULT", hit: false, msg: { sticker_id }, error: "Sem vizinhos" });
    }

    state.searchHistory.push({
        ts: new Date().toISOString(),
        type: "SENT",
        sticker_id,
        query_id,
    });
    recordMessage("OUT", "SEARCH", "broadcast", { sticker_id, query_id, neighbors_count: sent });
    schedulePersist();
    pushStateToFrontend();
}

/**
 * Envia TRADE_OFFER por flooding.
 * NÃO exige que target_peer_id seja um vizinho direto.
 * A mensagem viaja pela rede até encontrar o destinatário.
 */
function cmdTradeOffer(cmd) {
    const { target_peer_id, offer_sticker_id, want_sticker_id } = cmd;

    if (!offer_sticker_id || !want_sticker_id || !target_peer_id) {
        return broadcastToFrontend({ type: "ERROR", msg: "Preencha todos os campos da proposta de troca" });
    }
    if (!state.inventory[offer_sticker_id] || state.inventory[offer_sticker_id] <= 0) {
        return broadcastToFrontend({ type: "ERROR", msg: `Você não tem ${offer_sticker_id} para oferecer` });
    }

    const offer = {
        type: "TRADE_OFFER",
        message_id: uuidv4(),
        origin_peer_id: PEER_ID,
        sender_peer_id: PEER_ID,
        receiver_peer_id: target_peer_id,
        offer_sticker_id,
        want_sticker_id,
        ttl: DEFAULT_TTL,
    };

    // Marca como já visto (para não reprocessar echo)
    state.seenMsgIds.add(offer.message_id);

    // Verifica se o destinatário é vizinho direto
    const directWs = state.neighbors[target_peer_id]?.ws;
    let sent = 0;
    if (directWs && directWs.readyState === WebSocket.OPEN) {
        send(directWs, offer);
        sent = 1;
        log("TRADE", `Oferta enviada diretamente para ${target_peer_id}`);
    } else {
        // Inunda para todos os vizinhos — a mensagem vai chegar via TTL
        for (const [pid, n] of Object.entries(state.neighbors)) {
            if (n.ws?.readyState === WebSocket.OPEN) {
                send(n.ws, { ...offer, receiver_peer_id: target_peer_id });
                sent++;
            }
        }
        log("TRADE", `Oferta inundada para ${sent} vizinho(s) em direção a ${target_peer_id}`);
    }

    if (sent === 0) {
        broadcastToFrontend({ type: "ERROR", msg: "Sem vizinhos conectados para encaminhar a oferta" });
    } else {
        recordMessage("OUT", "TRADE_OFFER", target_peer_id, {
            offer: offer_sticker_id,
            want: want_sticker_id,
            message_id: offer.message_id,
            flooded_to: sent,
        });
        broadcastToFrontend({ type: "TRADE_SENT", target: target_peer_id, offer: offer_sticker_id, want: want_sticker_id });
    }
    schedulePersist();
}

/**
 * Aceita uma oferta de troca pendente.
 * Envia TRADE_ACCEPT via flood — não exige vizinho direto.
 */
function cmdTradeAccept(cmd) {
    const { trade_message_id } = cmd;
    const trade = state.pendingTrades[trade_message_id];
    if (!trade) return;

    if (!state.inventory[trade.want] || state.inventory[trade.want] <= 0) {
        return broadcastToFrontend({ type: "ERROR", msg: `Você não tem ${trade.want} para trocar` });
    }

    const accept = {
        type: "TRADE_ACCEPT",
        message_id: uuidv4(),
        origin_peer_id: PEER_ID,
        sender_peer_id: PEER_ID,
        receiver_peer_id: trade.from_peer_id,
        offer_sticker_id: trade.want,
        want_sticker_id: trade.offer,
        ttl: DEFAULT_TTL,
    };

    state.seenMsgIds.add(accept.message_id);

    const directWs = state.neighbors[trade.from_peer_id]?.ws;
    let sent = 0;
    if (directWs && directWs.readyState === WebSocket.OPEN) {
        send(directWs, accept);
        sent = 1;
    } else {
        for (const [pid, n] of Object.entries(state.neighbors)) {
            if (n.ws?.readyState === WebSocket.OPEN) {
                send(n.ws, { ...accept });
                sent++;
            }
        }
    }

    recordMessage("OUT", "TRADE_ACCEPT", trade.from_peer_id, {
        offer: trade.want,
        want: trade.offer,
        flooded_to: sent,
    });
    delete state.pendingTrades[trade_message_id];
    log("TRADE", `Troca aceita com ${trade.from_peer_id} (enviado para ${sent} vizinhos)`);
    schedulePersist();
}

/**
 * Rejeita uma oferta de troca pendente.
 * Envia TRADE_REJECT via flood.
 */
function cmdTradeReject(cmd) {
    const { trade_message_id } = cmd;
    const trade = state.pendingTrades[trade_message_id];
    if (!trade) return;

    const reject = {
        type: "TRADE_REJECT",
        message_id: uuidv4(),
        origin_peer_id: PEER_ID,
        sender_peer_id: PEER_ID,
        receiver_peer_id: trade.from_peer_id,
        offer_sticker_id: trade.offer,
        want_sticker_id: trade.want,
        ttl: DEFAULT_TTL,
    };

    state.seenMsgIds.add(reject.message_id);

    const directWs = state.neighbors[trade.from_peer_id]?.ws;
    let sent = 0;
    if (directWs && directWs.readyState === WebSocket.OPEN) {
        send(directWs, reject);
        sent = 1;
    } else {
        for (const [pid, n] of Object.entries(state.neighbors)) {
            if (n.ws?.readyState === WebSocket.OPEN) {
                send(n.ws, { ...reject });
                sent++;
            }
        }
    }

    recordMessage("OUT", "TRADE_REJECT", trade.from_peer_id, {
        offer: trade.offer,
        want: trade.want,
    });
    delete state.pendingTrades[trade_message_id];
    broadcastToFrontend({ type: "TRADE_REJECTED_BY_ME", trade });
    log("TRADE", `Troca rejeitada com ${trade.from_peer_id}`);
    schedulePersist();
}

// ─── Persiste ao encerrar ─────────────────────────────────────────────────────
process.on("SIGINT", () => {
    log("SHUTDOWN", "Encerrando servidor, salvando estado...");
    persistState();
    process.exit(0);
});

process.on("SIGTERM", () => {
    persistState();
    process.exit(0);
});

// ─── Pronto ───────────────────────────────────────────────────────────────────
log("READY", `Sistema P2P pronto. PEER: ${PEER_ID} | Figurinha: ${MY_STICKER_ID} | Inventário inicial: ${INITIAL_STICKER_COPIES} cópias`);
log("READY", `Frontend: http://localhost:${PORT + 2}`);
log("READY", `P2P WebSocket: ws://localhost:${PORT}`);
log("READY", `Frontend WebSocket: ws://${LOCAL_IP}:${frontendPort}`);
log("READY", `Persistência: ${INVENTORY_FILE}`);