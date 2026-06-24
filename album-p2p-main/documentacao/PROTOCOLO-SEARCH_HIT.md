# Protocolo: SEARCH_HIT

Resposta positiva ao `SEARCH`. Enviado diretamente ao nó que enviou a busca quando o nó local possui a figurinha no inventário.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"SEARCH_HIT"` |
| `message_id` | sim | UUID único da mensagem |
| `origin_peer_id` | sim | Nó que possui a figurinha |
| `sender_peer_id` | sim | Nó que está enviando esta mensagem |
| `receiver_peer_id` | sim | Nó que iniciou a busca (`origin_peer_id` do SEARCH) |
| `query_id` | sim | Mesmo `query_id` do SEARCH original |
| `sticker_id` | sim | Figurinha encontrada |

## Exemplo

```json
{
  "type": "SEARCH_HIT",
  "message_id": "550e8400-e29b-41d4-a716-446655440004",
  "origin_peer_id": "ALUNO-01",
  "sender_peer_id": "ALUNO-01",
  "receiver_peer_id": "ALUNO-03",
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "sticker_id": "FIG-12"
}
```
