// protocol.js — Constantes e builders de mensagens do protocolo P2P
// Os campos de cada mensagem seguem EXATAMENTE as specs em documentacao/
const { v4: uuidv4 } = require('uuid');

// Tipos de mensagem definidos na especificação
const MSG_TYPES = {
  HELLO:            'HELLO',
  SEARCH:           'SEARCH',
  SEARCH_HIT:       'SEARCH_HIT',
  SEARCH_MISS:      'SEARCH_MISS',
  TRADE_OFFER:      'TRADE_OFFER',
  TRADE_ACCEPT:     'TRADE_ACCEPT',
  TRADE_REJECT:     'TRADE_REJECT',
  TRANSFER_CONFIRM: 'TRANSFER_CONFIRM',
};

// --- Builders ---
// Cada função retorna um objeto pronto para ser enviado via JSON.

// HELLO — anuncia presença a um vizinho
// Spec: documentacao/PROTOCOLO-HELLO.md
function buildHello(senderPeerId, knownPeers = []) {
  return {
    type:           MSG_TYPES.HELLO,
    message_id:     uuidv4(),
    sender_peer_id: senderPeerId,
    peers:          knownPeers, // lista opcional de endereços conhecidos
  };
}

// SEARCH — busca uma figurinha na rede por inundação
// Spec: documentacao/PROTOCOLO-SEARCH.md
function buildSearch(originPeerId, senderPeerId, receiverPeerId, stickerId, ttl, queryId, originPeerIp) {
  return {
    type:             MSG_TYPES.SEARCH,
    message_id:       uuidv4(),       // novo UUID a cada reenvio
    origin_peer_id:   originPeerId,   // quem iniciou a busca (não muda)
    origin_peer_ip:   originPeerIp || null, // IP do nó originador (não muda)
    sender_peer_id:   senderPeerId,   // quem está enviando esta cópia
    receiver_peer_id: receiverPeerId, // vizinho destinatário
    query_id:         queryId || uuidv4(), // mesmo em todos os repasses
    ttl:              ttl,            // começa em 7, decrementa a cada repasse
    sticker_id:       stickerId,
  };
}

// SEARCH_HIT — resposta positiva: este nó possui a figurinha
// Spec: documentacao/PROTOCOLO-SEARCH_HIT.md
function buildSearchHit(originPeerId, senderPeerId, receiverPeerId, queryId, stickerId) {
  return {
    type:             MSG_TYPES.SEARCH_HIT,
    message_id:       uuidv4(),
    origin_peer_id:   originPeerId,   // nó que possui a figurinha
    sender_peer_id:   senderPeerId,   // quem está enviando
    receiver_peer_id: receiverPeerId, // nó que iniciou a busca
    query_id:         queryId,
    sticker_id:       stickerId,
  };
}

// SEARCH_MISS — resposta opcional: este nó não possui a figurinha
// Spec: documentacao/PROTOCOLO-SEARCH_MISS.md
function buildSearchMiss(originPeerId, senderPeerId, receiverPeerId, queryId, stickerId) {
  return {
    type:             MSG_TYPES.SEARCH_MISS,
    message_id:       uuidv4(),
    origin_peer_id:   originPeerId,
    sender_peer_id:   senderPeerId,
    receiver_peer_id: receiverPeerId,
    query_id:         queryId,
    sticker_id:       stickerId,
  };
}

// TRADE_OFFER — propõe uma troca direta
// Spec: documentacao/PROTOCOLO-TRADE_OFFER.md
function buildTradeOffer(originPeerId, senderPeerId, receiverPeerId, offerStickerId, wantStickerId) {
  return {
    type:             MSG_TYPES.TRADE_OFFER,
    message_id:       uuidv4(),
    origin_peer_id:   originPeerId,
    sender_peer_id:   senderPeerId,
    receiver_peer_id: receiverPeerId,
    offer_sticker_id: offerStickerId, // figurinha que estou oferecendo
    want_sticker_id:  wantStickerId,  // figurinha que desejo receber
  };
}

// TRADE_ACCEPT — aceita a proposta de troca
// Spec: documentacao/PROTOCOLO-TRADE_ACCEPT.md
function buildTradeAccept(originPeerId, senderPeerId, receiverPeerId, offerStickerId, wantStickerId) {
  return {
    type:             MSG_TYPES.TRADE_ACCEPT,
    message_id:       uuidv4(),
    origin_peer_id:   originPeerId,   // nó que está aceitando
    sender_peer_id:   senderPeerId,
    receiver_peer_id: receiverPeerId, // nó que fez a oferta
    offer_sticker_id: offerStickerId, // o que o aceitante irá enviar (era o want do ofertante)
    want_sticker_id:  wantStickerId,  // o que o aceitante irá receber (era o offer do ofertante)
  };
}

// TRADE_REJECT — rejeita a proposta de troca
// Spec: documentacao/PROTOCOLO-TRADE_REJECT.md
function buildTradeReject(originPeerId, senderPeerId, receiverPeerId, offerStickerId, wantStickerId) {
  return {
    type:             MSG_TYPES.TRADE_REJECT,
    message_id:       uuidv4(),
    origin_peer_id:   originPeerId,
    sender_peer_id:   senderPeerId,
    receiver_peer_id: receiverPeerId,
    offer_sticker_id: offerStickerId, // figurinha da oferta original
    want_sticker_id:  wantStickerId,  // figurinha desejada da oferta original
  };
}

// TRANSFER_CONFIRM — confirma que a troca foi concluída e o inventário foi atualizado
// Spec: documentacao/PROTOCOLO-TRANSFER_CONFIRM.md
function buildTransferConfirm(originPeerId, senderPeerId, receiverPeerId, offerStickerId, wantStickerId) {
  return {
    type:             MSG_TYPES.TRANSFER_CONFIRM,
    message_id:       uuidv4(),
    origin_peer_id:   originPeerId,
    sender_peer_id:   senderPeerId,
    receiver_peer_id: receiverPeerId,
    offer_sticker_id: offerStickerId, // figurinha transferida pelo remetente
    want_sticker_id:  wantStickerId,  // figurinha recebida pelo remetente
  };
}

module.exports = {
  MSG_TYPES,
  buildHello,
  buildSearch,
  buildSearchHit,
  buildSearchMiss,
  buildTradeOffer,
  buildTradeAccept,
  buildTradeReject,
  buildTransferConfirm,
};
