# Protocolo: TRANSFER_CONFIRM

Confirma que a troca foi concluída e os inventários devem ser atualizados. Enviado após o `TRADE_ACCEPT`. Ambos os nós devem processar esta mensagem para decrementar a figurinha enviada e incrementar a recebida.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"TRANSFER_CONFIRM"` |
| `message_id` | sim | UUID único da mensagem |
| `origin_peer_id` | sim | Nó que confirma a transferência |
| `sender_peer_id` | sim | Nó que está enviando |
| `receiver_peer_id` | sim | Nó destinatário |
| `offer_sticker_id` | sim | Figurinha transferida pelo remetente |
| `want_sticker_id` | sim | Figurinha recebida pelo remetente |

## Exemplo

```json
{
  "type": "TRANSFER_CONFIRM",
  "message_id": "550e8400-e29b-41d4-a716-446655440009",
  "origin_peer_id": "ALUNO-01",
  "sender_peer_id": "ALUNO-01",
  "receiver_peer_id": "ALUNO-23",
  "offer_sticker_id": "FIG-01",
  "want_sticker_id": "FIG-23"
}
```
