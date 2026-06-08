const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;
const wss  = new WebSocket.Server({ port: PORT });

// Estado compartilhado
const processedQueries = new Set();
const connectedPeers   = new Map(); // peerId -> socket
const MY_PEER_ID       = 'ALUNO-12';

// Inventário inicial: 28 cópias de FIG-12
const inventory = {};
for (let i = 1; i <= 28; i++) {
    const id = `FIG-${String(i).padStart(2,'0')}`;
    inventory[id] = { quantity: 0, file: `${id}.png` };
}
inventory['FIG-12'] = { quantity: 28, file: 'FIG-12.png' };

// ─────────────────────────────────────────────────────────────────────────────
wss.on('connection', (socket) => {
    let remotePeerId = null;
    console.log('[wsServer] Nova conexão recebida');

    socket.on('message', (rawData) => {
        let msg;
        try { msg = JSON.parse(rawData.toString()); }
        catch { console.error('[wsServer] JSON inválido'); return; }

        console.log(`[wsServer] ← ${msg.type} de ${msg.peer_id}`);

        switch (msg.type) {

            case 'HELLO': {
                remotePeerId = msg.peer_id;
                connectedPeers.set(remotePeerId, socket);
                wss.emit('peer_connected', remotePeerId);

                socket.send(JSON.stringify({
                    type: 'HELLO',
                    peer_id: MY_PEER_ID,
                    port: PORT,
                    inventory: buildInventorySummary()
                }));
                break;
            }

            case 'SEARCH': {
                const { query_id, sticker_id, ttl = 7, peer_id } = msg;
                if (!query_id || !sticker_id) return;

                if (processedQueries.has(query_id)) {
                    console.log(`[wsServer] Duplicata ignorada: ${query_id}`);
                    return;
                }
                processedQueries.add(query_id);

                const found = inventory[sticker_id]?.quantity > 0;

                if (found) {
                    socket.send(JSON.stringify({
                        type: 'SEARCH_HIT',
                        query_id, peer_id: MY_PEER_ID, sticker_id,
                        available_quantity: inventory[sticker_id].quantity,
                        file: inventory[sticker_id].file
                    }));
                } else {
                    // Propaga com TTL decrementado
                    if (ttl > 1) {
                        const fwd = JSON.stringify({ ...msg, ttl: ttl - 1 });
                        for (const [pid, peer] of connectedPeers.entries()) {
                            if (pid !== peer_id && peer.readyState === WebSocket.OPEN) peer.send(fwd);
                        }
                    }
                    socket.send(JSON.stringify({
                        type: 'SEARCH_MISS',
                        query_id, peer_id: MY_PEER_ID, sticker_id
                    }));
                }
                break;
            }

            case 'SEARCH_HIT':
                wss.emit('search_hit', msg);
                break;

            case 'SEARCH_MISS':
                wss.emit('search_miss', msg);
                break;

            case 'TRADE_OFFER': {
                const { query_id, sticker_id, offered_sticker_id, peer_id } = msg;
                const hasRequested = inventory[sticker_id]?.quantity > 0;
                const wantsOffered = inventory[offered_sticker_id]?.quantity === 0;

                if (hasRequested && wantsOffered) {
                    socket.send(JSON.stringify({
                        type: 'TRADE_ACCEPT',
                        query_id, peer_id: MY_PEER_ID, sticker_id, offered_sticker_id
                    }));
                    wss.emit('trade_accepted', msg);
                } else {
                    socket.send(JSON.stringify({
                        type: 'TRADE_REJECT',
                        query_id, peer_id: MY_PEER_ID, sticker_id,
                        reason: !hasRequested ? 'Figurinha não disponível' : 'Já possuo essa figurinha'
                    }));
                }
                break;
            }

            case 'TRADE_ACCEPT':
                wss.emit('trade_accepted', msg);
                break;

            case 'TRADE_REJECT':
                wss.emit('trade_rejected', msg);
                break;

            case 'TRANSFER_CONFIRM': {
                const { sticker_id, offered_sticker_id } = msg;
                if (inventory[sticker_id]?.quantity > 0)  inventory[sticker_id].quantity--;
                if (inventory[offered_sticker_id])         inventory[offered_sticker_id].quantity++;
                console.log(`[wsServer] Inventário: -${sticker_id} / +${offered_sticker_id}`);
                wss.emit('transfer_confirmed', msg);
                break;
            }

            default:
                console.warn(`[wsServer] Tipo desconhecido: ${msg.type}`);
        }
    });

    socket.on('close', () => {
        if (remotePeerId) {
            connectedPeers.delete(remotePeerId);
            wss.emit('peer_disconnected', remotePeerId);
            console.log(`[wsServer] Peer desconectado: ${remotePeerId}`);
        }
    });

    socket.on('error', (err) => console.error(`[wsServer] Erro (${remotePeerId}):`, err.message));
});

function buildInventorySummary() {
    return Object.entries(inventory).map(([id, d]) => ({
        sticker_id: id, quantity: d.quantity, file: d.file
    }));
}

console.log(`[wsServer] Escutando na porta ${PORT}`);

module.exports = { wss, inventory, processedQueries, connectedPeers, MY_PEER_ID, buildInventorySummary };