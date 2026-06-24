// message-handler.js — Roteador central: recebe mensagens dos peers e despacha para o módulo certo
const { MSG_TYPES } = require('./protocol');

class MessageHandler {
  constructor(peerEngine, tradeManager, notifyUi) {
    this.peerEngine   = peerEngine;
    this.tradeManager = tradeManager;
    this.notifyUi     = notifyUi; // função que envia eventos para o browser
  }

  // Processar qualquer mensagem recebida de um peer
  handle(msg, sourceWs) {
    if (!msg?.type) {
      console.warn('[HANDLER] Mensagem sem tipo recebida:', msg);
      return;
    }

    // Encaminhar para o log da UI
    this.notifyUi(JSON.stringify({ type: 'log', direction: 'incoming', message: msg }));

    // Despachar para o módulo responsável
    switch (msg.type) {
      case MSG_TYPES.HELLO:
        // HELLO já é tratado pelo NeighborManager; aqui apenas notificamos a UI
        // com o sender_peer_id para que ela possa atualizar a lista de vizinhos
        this.notifyUi(JSON.stringify({
          type: 'neighbor_update',
          data: { peer_id: msg.sender_peer_id },
        }));
        break;

      case MSG_TYPES.SEARCH:
        this.peerEngine.handleSearch(msg, sourceWs);
        break;

      case MSG_TYPES.SEARCH_HIT:
        this.peerEngine.handleSearchHit(msg, sourceWs);
        break;

      case MSG_TYPES.SEARCH_MISS:
        this.peerEngine.handleSearchMiss(msg);
        break;

      case MSG_TYPES.TRADE_OFFER:
        this.tradeManager.handleTradeOffer(msg);
        break;

      case MSG_TYPES.TRADE_ACCEPT:
        this.tradeManager.handleTradeAccept(msg);
        break;

      case MSG_TYPES.TRADE_REJECT:
        this.tradeManager.handleTradeReject(msg);
        break;

      case MSG_TYPES.TRANSFER_CONFIRM:
        this.tradeManager.handleTransferConfirm(msg);
        break;

      default:
        console.warn(`[HANDLER] Tipo desconhecido: ${msg.type}`);
    }
  }
}

module.exports = MessageHandler;
