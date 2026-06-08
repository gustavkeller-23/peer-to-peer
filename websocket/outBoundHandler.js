const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const MY_PEER_ID = 'ALUNO-12';
const DEFAULT_TTL = 7;

// Mapa de conexões abertas com outros peers: peerId -> WebSocket
const peerConnections = new Map();

/**
 * Conecta a um peer remoto pelo endereço ws://host:porta
 * e registra os handlers de mensagem.
 *
 * @param {string} address  - ex.: 'ws://localhost:8081'
 * @param {object} callbacks - { onSearchHit, onSearchMiss, onTradeAccept, onTradeReject, onTransferConfirm }
 * @returns {WebSocket}
 */
function connectToPeer(address, callbacks = {}) {
    if (peerConnections.has(address)) {
        console.log(`[wsClient] Já conectado a ${address}`);
        return peerConnections.get(address);
    }

    const socket = new WebSocket(address);

    socket.on('open', () => {
        console.log(`[wsClient] Conectado a ${address}`);

        // Handshake inicial
        socket.send(JSON.stringify({
            type: 'HELLO',
            peer_id: MY_PEER_ID,
            port: 8080
        }));

        peerConnections.set(address, socket);
    });

    socket.on('message', (rawData) => {
        let msg;
        try {
            msg = JSON.parse(rawData.toString());
        } catch (e) {
            console.error('[wsClient] Mensagem inválida:', rawData.toString());
            return;
        }

        console.log(`[wsClient] Recebido tipo=${msg.type} de ${address}`);

        switch (msg.type) {

            case 'HELLO':
                console.log(`[wsClient] HELLO de ${msg.peer_id}, inventário:`, msg.inventory);
                callbacks.onHello && callbacks.onHello(msg);
                break;

            case 'SEARCH':
                // Recebemos uma busca de um peer remoto (roteamento / flood)
                callbacks.onSearch && callbacks.onSearch(msg, socket);
                break;

            case 'SEARCH_HIT':
                console.log(`[wsClient] SEARCH_HIT: ${msg.sticker_id} disponível em ${msg.peer_id}`);
                callbacks.onSearchHit && callbacks.onSearchHit(msg, socket);
                break;

            case 'SEARCH_MISS':
                console.log(`[wsClient] SEARCH_MISS: ${msg.sticker_id} não encontrado em ${msg.peer_id}`);
                callbacks.onSearchMiss && callbacks.onSearchMiss(msg);
                break;

            case 'TRADE_OFFER':
                console.log(`[wsClient] TRADE_OFFER recebido: querem ${msg.sticker_id}, oferecem ${msg.offered_sticker_id}`);
                callbacks.onTradeOffer && callbacks.onTradeOffer(msg, socket);
                break;

            case 'TRADE_ACCEPT':
                console.log(`[wsClient] TRADE_ACCEPT: troca confirmada com ${msg.peer_id}`);
                callbacks.onTradeAccept && callbacks.onTradeAccept(msg, socket);
                break;

            case 'TRADE_REJECT':
                console.log(`[wsClient] TRADE_REJECT de ${msg.peer_id}: ${msg.reason}`);
                callbacks.onTradeReject && callbacks.onTradeReject(msg);
                break;

            case 'TRANSFER_CONFIRM':
                console.log(`[wsClient] TRANSFER_CONFIRM de ${msg.peer_id}`);
                callbacks.onTransferConfirm && callbacks.onTransferConfirm(msg);
                break;

            default:
                console.warn(`[wsClient] Tipo desconhecido: ${msg.type}`);
        }
    });

    socket.on('close', () => {
        console.log(`[wsClient] Desconectado de ${address}`);
        peerConnections.delete(address);
    });

    socket.on('error', (err) => {
        console.error(`[wsClient] Erro ao conectar em ${address}:`, err.message);
        peerConnections.delete(address);
    });

    return socket;
}

// ─── Funções de envio de mensagens ──────────────────────────────────────────

/**
 * Envia SEARCH para um peer específico.
 * @param {WebSocket} socket
 * @param {string} stickerId - ex.: 'FIG-05'
 * @returns {string} query_id gerado
 */
function sendSearch(socket, stickerId) {
    const query_id = uuidv4();
    const msg = {
        type: 'SEARCH',
        peer_id: MY_PEER_ID,
        query_id,
        sticker_id: stickerId,
        ttl: DEFAULT_TTL
    };
    socket.send(JSON.stringify(msg));
    console.log(`[wsClient] SEARCH enviado: ${stickerId} (query_id=${query_id})`);
    return query_id;
}

/**
 * Envia TRADE_OFFER para um peer.
 * @param {WebSocket} socket
 * @param {string} query_id
 * @param {string} wantedSticker - figurinha que quero do peer
 * @param {string} offeredSticker - figurinha que ofereço em troca
 */
function sendTradeOffer(socket, query_id, wantedSticker, offeredSticker) {
    socket.send(JSON.stringify({
        type: 'TRADE_OFFER',
        peer_id: MY_PEER_ID,
        query_id,
        sticker_id: wantedSticker,
        offered_sticker_id: offeredSticker
    }));
    console.log(`[wsClient] TRADE_OFFER enviado: quero ${wantedSticker}, ofereço ${offeredSticker}`);
}

/**
 * Envia TRANSFER_CONFIRM confirmando a troca final.
 * @param {WebSocket} socket
 * @param {string} query_id
 * @param {string} stickerId - figurinha que estou enviando
 * @param {string} offeredStickerId - figurinha que estou recebendo
 */
function sendTransferConfirm(socket, query_id, stickerId, offeredStickerId) {
    socket.send(JSON.stringify({
        type: 'TRANSFER_CONFIRM',
        peer_id: MY_PEER_ID,
        query_id,
        sticker_id: stickerId,
        offered_sticker_id: offeredStickerId
    }));
    console.log(`[wsClient] TRANSFER_CONFIRM enviado: enviei ${stickerId}, recebi ${offeredStickerId}`);
}

/**
 * Envia busca para TODOS os peers conectados.
 * @param {string} stickerId
 * @returns {string} query_id
 */
function broadcastSearch(stickerId) {
    const query_id = uuidv4();
    const msg = JSON.stringify({
        type: 'SEARCH',
        peer_id: MY_PEER_ID,
        query_id,
        sticker_id: stickerId,
        ttl: DEFAULT_TTL
    });

    for (const [address, socket] of peerConnections.entries()) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(msg);
        }
    }

    console.log(`[wsClient] SEARCH broadcast: ${stickerId} (query_id=${query_id})`);
    return query_id;
}

module.exports = {
    connectToPeer,
    sendSearch,
    sendTradeOffer,
    sendTransferConfirm,
    broadcastSearch,
    peerConnections
};
