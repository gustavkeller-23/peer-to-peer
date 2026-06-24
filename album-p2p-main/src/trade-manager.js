// trade-manager.js — Gerencia o ciclo de vida das trocas de figurinhas
//
// Fluxo correto segundo a spec (documentacao/):
//   1. A: proposeTrade()       → envia TRADE_OFFER      → B
//   2. B: handleTradeOffer()   → armazena, mostra para o usuário
//   3. B: acceptTrade()        → envia TRADE_ACCEPT      → A   (NÃO atualiza inventário ainda)
//   4. A: handleTradeAccept()  → atualiza inventário de A, envia TRANSFER_CONFIRM → B
//   5. B: handleTransferConfirm() → atualiza inventário de B, troca concluída
//
// TRANSFER_CONFIRM:
//   - offer_sticker_id = figurinha transferida pelo remetente (= o que o ofertante ofereceu)
//   - want_sticker_id  = figurinha recebida pelo remetente    (= o que o ofertante queria)
//
const EventEmitter = require('events');
const {
  buildTradeOffer,
  buildTradeAccept,
  buildTradeReject,
  buildTransferConfirm,
} = require('./protocol');

// Estados possíveis de uma troca (ciclo de vida)
const STATUS = {
  PENDING:   'PENDING',   // aguardando resposta
  ACCEPTED:  'ACCEPTED',  // aceita, aguardando TRANSFER_CONFIRM
  REJECTED:  'REJECTED',  // recusada
  CONFIRMED: 'CONFIRMED', // transferência confirmada, inventários atualizados
};

class TradeManager extends EventEmitter {
  constructor(peerId, inventory, neighborManager) {
    super();
    this.peerId          = peerId;
    this.inventory       = inventory;
    this.neighborManager = neighborManager;

    this.trades      = new Map(); // Map<trade_id, objeto de troca>
    this.tradeHistory = [];       // histórico das últimas 100 trocas
  }

  // ─── Ações do usuário ─────────────────────────────────────────────────────

  // Propor troca: ofereço minha figurinha, quero a figurinha do outro peer
  proposeTrade(targetPeerId, offerStickerId, wantStickerId) {
    if (!this.inventory.canTrade(offerStickerId, 1)) {
      throw new Error(`Sem ${offerStickerId} disponível para troca`);
    }

    const msg = buildTradeOffer(this.peerId, this.peerId, targetPeerId, offerStickerId, wantStickerId);

    // Armazenar localmente usando o message_id como identificador da troca
    const trade = {
      trade_id:         msg.message_id,
      initiator:        this.peerId,
      target:           targetPeerId,
      offer_sticker_id: offerStickerId,
      want_sticker_id:  wantStickerId,
      status:           STATUS.PENDING,
      direction:        'outgoing',
    };

    this.trades.set(trade.trade_id, trade);
    this.neighborManager.sendTo(targetPeerId, msg);

    console.log(`[TROCA] Proposta enviada → ${targetPeerId}: ofereço ${offerStickerId}, quero ${wantStickerId}`);
    this.emit('trade_proposed', trade);
    return trade;
  }

  // Aceitar uma proposta recebida (chamado pela UI com o trade_id)
  // IMPORTANTE: NÃO atualiza inventário aqui — aguarda TRANSFER_CONFIRM (spec)
  acceptTrade(tradeId) {
    const trade = this._getTrade(tradeId);

    if (!trade.initiator) {
      throw new Error('Não é possível aceitar: peer de origem desconhecido');
    }

    // Verificar se temos a figurinha que o outro quer (= o que o ofertante quer)
    if (!this.inventory.canTrade(trade.want_sticker_id, 1)) {
      this.rejectTrade(tradeId, 'Inventário insuficiente');
      throw new Error(`Sem ${trade.want_sticker_id} disponível`);
    }

    trade.status = STATUS.ACCEPTED;

    // TRADE_ACCEPT:
    //   offer_sticker_id = figurinha que o aceitante irá enviar  = o que o ofertante queria (want)
    //   want_sticker_id  = figurinha que o aceitante irá receber = o que o ofertante oferecia (offer)
    const msg = buildTradeAccept(
      this.peerId, this.peerId, trade.initiator,
      trade.want_sticker_id,   // offer do accept = want da oferta original (o que vou enviar)
      trade.offer_sticker_id,  // want  do accept = offer da oferta original (o que vou receber)
    );
    this.neighborManager.sendTo(trade.initiator, msg);

    console.log(`[TROCA] ✓ Aceita: ${tradeId} — aguardando TRANSFER_CONFIRM para atualizar inventário`);
    this.emit('trade_accepted', trade);
    return trade;
  }

  // Rejeitar uma proposta recebida
  rejectTrade(tradeId, reason = 'Troca recusada') {
    const trade = this._getTrade(tradeId);
    trade.status = STATUS.REJECTED;
    trade.reason = reason;

    // TRADE_REJECT:
    //   offer_sticker_id = figurinha da oferta original (o que o ofertante ofereceu)
    //   want_sticker_id  = figurinha desejada da oferta original (o que o ofertante queria)
    const msg = buildTradeReject(
      this.peerId, this.peerId, trade.initiator,
      trade.offer_sticker_id,  // offer da oferta original
      trade.want_sticker_id,   // want da oferta original
    );
    this.neighborManager.sendTo(trade.initiator, msg);

    console.log(`[TROCA] ✗ Rejeitada: ${tradeId} (${reason})`);
    this.emit('trade_rejected', trade);
    this._saveHistory(trade);
    return trade;
  }

  // ─── Mensagens recebidas da rede ──────────────────────────────────────────

  // Recebemos uma proposta de troca
  handleTradeOffer(msg) {
    // Usar sender_peer_id como fallback se origin_peer_id não vier (interoperabilidade)
    const initiator = msg.origin_peer_id || msg.sender_peer_id;

    if (!initiator) {
      console.warn('[TROCA] TRADE_OFFER sem origin_peer_id nem sender_peer_id — descartado');
      return;
    }

    const trade = {
      trade_id:         msg.message_id,       // usamos o message_id para identificar a troca
      initiator,
      target:           this.peerId,
      offer_sticker_id: msg.offer_sticker_id, // o que o iniciador oferece
      want_sticker_id:  msg.want_sticker_id,  // o que o iniciador quer (o que eu tenho que dar)
      status:           STATUS.PENDING,
      direction:        'incoming',
    };

    this.trades.set(trade.trade_id, trade);
    console.log(`[TROCA] Proposta recebida ← ${initiator}: oferece ${msg.offer_sticker_id}, quer ${msg.want_sticker_id}`);
    this.emit('trade_received', trade);
    return trade;
  }

  // O outro peer aceitou nossa proposta
  // Tentamos as duas interpretações possíveis dos campos offer/want do TRADE_ACCEPT,
  // pois grupos diferentes podem preencher os campos de forma diferente.
  handleTradeAccept(msg) {
    // Interpretação 1 (spec): offer = o que aceitante envia, want = o que aceitante recebe
    //   → nossa trade: offer = msg.want, want = msg.offer
    let trade = this._findPending(msg.want_sticker_id, msg.offer_sticker_id, msg.origin_peer_id);

    // Interpretação 2 (espelho): offer/want do ponto de vista do ofertante original
    if (!trade) {
      trade = this._findPending(msg.offer_sticker_id, msg.want_sticker_id, msg.origin_peer_id);
    }

    // Fallback: qualquer trade pendente com este peer (útil se campos vierem incompletos)
    if (!trade) {
      trade = this._findPendingByPeer(msg.origin_peer_id);
    }

    if (!trade) {
      return console.warn(`[TROCA] ACCEPT sem proposta correspondente de ${msg.origin_peer_id}`);
    }

    // Atualizar inventário do ofertante (A):
    //   remove o que oferecemos, adiciona o que queríamos
    this.inventory.remove(trade.offer_sticker_id, 1);
    this.inventory.add(trade.want_sticker_id, 1);

    // Enviar TRANSFER_CONFIRM para o aceitante:
    //   offer_sticker_id = figurinha que NÓS transferimos (o que oferecemos)
    //   want_sticker_id  = figurinha que NÓS recebemos   (o que queríamos)
    const confirm = buildTransferConfirm(
      this.peerId, this.peerId, msg.origin_peer_id,
      trade.offer_sticker_id,  // o que transferimos
      trade.want_sticker_id,   // o que recebemos
    );
    this.neighborManager.sendTo(msg.origin_peer_id, confirm);

    trade.status = STATUS.CONFIRMED;
    console.log(`[TROCA] ✓ Concluída com ${msg.origin_peer_id} — inventário atualizado`);
    this.emit('trade_completed', trade);
    this._saveHistory(trade);
    return trade;
  }

  // O outro peer rejeitou nossa proposta
  // msg.offer_sticker_id = figurinha da oferta original (o que nós oferecemos)
  // msg.want_sticker_id  = figurinha desejada original  (o que nós queríamos)
  handleTradeReject(msg) {
    // Tenta interpretação 1: campos no ponto de vista da oferta original
    let trade = this._findPending(msg.offer_sticker_id, msg.want_sticker_id, msg.origin_peer_id);
    // Tenta interpretação 2: campos invertidos
    if (!trade) {
      trade = this._findPending(msg.want_sticker_id, msg.offer_sticker_id, msg.origin_peer_id);
    }
    // Fallback por peer
    if (!trade) {
      trade = this._findPendingByPeer(msg.origin_peer_id);
    }
    if (!trade) {
      return console.warn(`[TROCA] REJECT sem proposta correspondente de ${msg.origin_peer_id}`);
    }

    trade.status = STATUS.REJECTED;
    console.log(`[TROCA] ✗ Rejeitada por ${msg.origin_peer_id}`);
    this.emit('trade_rejected', trade);
    this._saveHistory(trade);
    return trade;
  }

  // O ofertante confirmou a transferência — agora o aceitante atualiza o inventário
  // msg.offer_sticker_id = o que o ofertante transferiu (= o que nós queríamos receber)
  // msg.want_sticker_id  = o que o ofertante recebeu   (= o que nós enviamos)
  handleTransferConfirm(msg) {
    // Buscar a troca pelo par de figurinhas e pelo peer contraparte
    // Nossa troca (incoming, ACCEPTED): offer = o que o ofertante nos ofereceu, want = o que ele quer de nós
    // msg.offer_sticker_id = o que ele enviou (= trade.offer_sticker_id)
    // msg.want_sticker_id  = o que ele recebeu (= trade.want_sticker_id)
    const trade = this._findAccepted(msg.origin_peer_id, msg.offer_sticker_id, msg.want_sticker_id);
    if (!trade) {
      return console.warn(`[TROCA] CONFIRM sem proposta correspondente de ${msg.origin_peer_id}`);
    }

    // Atualizar inventário do aceitante:
    //   remove o que enviamos ao ofertante (= want da oferta = msg.want_sticker_id)
    //   adiciona o que recebemos do ofertante (= offer da oferta = msg.offer_sticker_id)
    this.inventory.remove(trade.want_sticker_id, 1);
    this.inventory.add(trade.offer_sticker_id, 1);

    trade.status = STATUS.CONFIRMED;
    this._saveHistory(trade);
    console.log(`[TROCA] ✓ Confirmação recebida de ${msg.origin_peer_id} — inventário atualizado`);
    this.emit('trade_confirmed', trade);
    return trade;
  }

  // ─── Helpers internos ─────────────────────────────────────────────────────

  _getTrade(tradeId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error(`Troca não encontrada: ${tradeId}`);
    if (trade.status !== STATUS.PENDING) throw new Error(`Troca ${tradeId} não está pendente (status: ${trade.status})`);
    return trade;
  }

  // Encontra proposta PENDING onde:
  //   offer_sticker_id = o que ofertamos, want_sticker_id = o que queríamos
  _findPending(offerStickerId, wantStickerId, counterpartPeerId) {
    for (const trade of this.trades.values()) {
      if (
        trade.status           === STATUS.PENDING &&
        trade.offer_sticker_id === offerStickerId &&
        trade.want_sticker_id  === wantStickerId  &&
        (trade.initiator === counterpartPeerId || trade.target === counterpartPeerId)
      ) {
        return trade;
      }
    }
    return null;
  }

  // Fallback: retorna qualquer trade PENDING (outgoing) com o peer informado
  // Usado quando a outra implementação preenche offer/want de forma diferente
  _findPendingByPeer(counterpartPeerId) {
    for (const trade of this.trades.values()) {
      if (
        trade.status    === STATUS.PENDING &&
        trade.direction === 'outgoing' &&
        trade.target    === counterpartPeerId
      ) {
        console.warn(`[TROCA] ⚠ Fallback: encontrada trade pendente com ${counterpartPeerId} por peer_id apenas`);
        return trade;
      }
    }
    return null;
  }

  // Encontra proposta ACCEPTED para o aceitante (incoming) pelo peer contraparte e figurinhas
  _findAccepted(counterpartPeerId, offerStickerId, wantStickerId) {
    for (const trade of this.trades.values()) {
      if (
        trade.status           === STATUS.ACCEPTED &&
        trade.direction        === 'incoming' &&
        trade.initiator        === counterpartPeerId &&
        trade.offer_sticker_id === offerStickerId &&
        trade.want_sticker_id  === wantStickerId
      ) {
        return trade;
      }
    }
    // Fallback: qualquer ACCEPTED do mesmo peer (caso quantidades não batam por diferença de implementação)
    for (const trade of this.trades.values()) {
      if (
        trade.status    === STATUS.ACCEPTED &&
        trade.direction === 'incoming' &&
        trade.initiator === counterpartPeerId
      ) {
        return trade;
      }
    }
    return null;
  }

  _saveHistory(trade) {
    // Atualizar se já existir, senão adicionar
    const idx = this.tradeHistory.findIndex(h => h.trade_id === trade.trade_id);
    if (idx !== -1) {
      this.tradeHistory[idx] = { ...trade, updated_at: Date.now() };
    } else {
      this.tradeHistory.push({ ...trade, completed_at: Date.now() });
      if (this.tradeHistory.length > 100) {
        this.tradeHistory = this.tradeHistory.slice(-100);
      }
    }
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  getPendingTrades() {
    return [...this.trades.values()].filter(t => t.status === STATUS.PENDING);
  }

  getTradeHistory() {
    return [...this.tradeHistory];
  }
}

module.exports = TradeManager;
