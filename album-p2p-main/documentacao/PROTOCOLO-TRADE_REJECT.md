# Protocolo: TRADE_REJECT

Rejeita a proposta de troca recebida. Nenhum inventário é alterado.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"TRADE_REJECT"` |
| `message_id` | sim | UUID único da mensagem |
| `origin_peer_id` | sim | Nó que está rejeitando |
| `sender_peer_id` | sim | Nó que está enviando |
| `receiver_peer_id` | sim | Nó que fez a oferta |
| `offer_sticker_id` | sim | Figurinha da oferta original |
| `want_sticker_id` | sim | Figurinha desejada da oferta original |

## Exemplo

```json
{
  "type": "TRADE_REJECT",
  "message_id": "550e8400-e29b-41d4-a716-446655440008",
  "origin_peer_id": "ALUNO-01",
  "sender_peer_id": "ALUNO-01",
  "receiver_peer_id": "ALUNO-23",
  "offer_sticker_id": "FIG-23",
  "want_sticker_id": "FIG-01"
}
```
