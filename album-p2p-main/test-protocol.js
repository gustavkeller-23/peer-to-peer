const {
  buildHello,
  buildSearch,
  buildSearchHit,
  buildSearchMiss,
  buildTradeOffer,
  buildTradeAccept,
  buildTradeReject,
  buildTransferConfirm,
} = require('./src/protocol');

console.log('--- TESTANDO BUILDERS DO PROTOCOLO ---\n');

// 1. HELLO
const helloMsg = buildHello('MEU-NO-123', ['ws://192.168.0.10:8080']);
console.log('💌 HELLO:');
console.log(JSON.stringify(helloMsg, null, 2));
console.log('\n---------------------------------------\n');

// 2. SEARCH
const searchMsg = buildSearch('MEU-NO-123', 'MEU-NO-123', 'VIZINHO-456', 'FIG-01', 7, null, '192.168.0.50');
console.log('🔍 SEARCH:');
console.log(JSON.stringify(searchMsg, null, 2));
console.log('\n---------------------------------------\n');

// 3. SEARCH_HIT (sem quantity)
const searchHitMsg = buildSearchHit('MEU-NO-123', 'MEU-NO-123', 'ORIGEM-789', searchMsg.query_id, 'FIG-01');
console.log('✅ SEARCH_HIT:');
console.log(JSON.stringify(searchHitMsg, null, 2));
console.log('\n---------------------------------------\n');

// 4. SEARCH_MISS
const searchMissMsg = buildSearchMiss('MEU-NO-123', 'MEU-NO-123', 'ORIGEM-789', searchMsg.query_id, 'FIG-01');
console.log('❌ SEARCH_MISS:');
console.log(JSON.stringify(searchMissMsg, null, 2));
console.log('\n---------------------------------------\n');

// 5. TRADE_OFFER (sem offer_qty / want_qty)
const tradeOfferMsg = buildTradeOffer('MEU-NO-123', 'MEU-NO-123', 'ALVO-456', 'FIG-01', 'FIG-05');
console.log('🤝 TRADE_OFFER:');
console.log(JSON.stringify(tradeOfferMsg, null, 2));
console.log('\n---------------------------------------\n');

// 6. TRADE_ACCEPT
const tradeAcceptMsg = buildTradeAccept('MEU-NO-123', 'MEU-NO-123', 'OFERTANTE-789', 'FIG-05', 'FIG-01');
console.log('✔️ TRADE_ACCEPT:');
console.log(JSON.stringify(tradeAcceptMsg, null, 2));
console.log('\n---------------------------------------\n');

// 7. TRADE_REJECT
const tradeRejectMsg = buildTradeReject('MEU-NO-123', 'MEU-NO-123', 'OFERTANTE-789', 'FIG-01', 'FIG-05');
console.log('✗ TRADE_REJECT:');
console.log(JSON.stringify(tradeRejectMsg, null, 2));
console.log('\n---------------------------------------\n');

// 8. TRANSFER_CONFIRM
const transferMsg = buildTransferConfirm('MEU-NO-123', 'MEU-NO-123', 'ACEITANTE-456', 'FIG-01', 'FIG-05');
console.log('📦 TRANSFER_CONFIRM:');
console.log(JSON.stringify(transferMsg, null, 2));

console.log('\n--- FIM DOS TESTES ---');
