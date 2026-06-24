# Protocolo: TRADE_OFFER

Propõe uma troca direta entre dois nós. Só deve ser enviado após um `SEARCH_HIT` confirmar que o destinatário possui a figurinha desejada.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"TRADE_OFFER"` |
| `message_id` | sim | UUID único da mensagem |
| `origin_peer_id` | sim | Nó que propõe a troca |
| `sender_peer_id` | sim | Nó que está enviando |
| `receiver_peer_id` | sim | Nó destinatário da proposta |
| `offer_sticker_id` | sim | Figurinha que o remetente está oferecendo |
| `want_sticker_id` | sim | Figurinha que o remetente deseja receber |

## Exemplo

```json
{
  "type": "TRADE_OFFER",
  "message_id": "550e8400-e29b-41d4-a716-446655440006",
  "origin_peer_id": "ALUNO-23",
  "sender_peer_id": "ALUNO-23",
  "receiver_peer_id": "ALUNO-01",
  "offer_sticker_id": "FIG-23",
  "want_sticker_id": "FIG-01"
}
```
