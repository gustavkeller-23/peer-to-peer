# Protocolo: TRADE_ACCEPT

Aceita a proposta de troca recebida. Após o envio, ambos os nós devem aguardar o `TRANSFER_CONFIRM` para atualizar o inventário.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"TRADE_ACCEPT"` |
| `message_id` | sim | UUID único da mensagem |
| `origin_peer_id` | sim | Nó que está aceitando |
| `sender_peer_id` | sim | Nó que está enviando |
| `receiver_peer_id` | sim | Nó que fez a oferta |
| `offer_sticker_id` | sim | Figurinha que o aceitante irá enviar (era o `want` do ofertante) |
| `want_sticker_id` | sim | Figurinha que o aceitante irá receber (era o `offer` do ofertante) |

## Exemplo

```json
{
  "type": "TRADE_ACCEPT",
  "message_id": "550e8400-e29b-41d4-a716-446655440007",
  "origin_peer_id": "ALUNO-01",
  "sender_peer_id": "ALUNO-01",
  "receiver_peer_id": "ALUNO-23",
  "offer_sticker_id": "FIG-01",
  "want_sticker_id": "FIG-23"
}
```
