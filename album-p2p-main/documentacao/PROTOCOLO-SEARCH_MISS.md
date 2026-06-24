# Protocolo: SEARCH_MISS

Resposta opcional indicando que o nó local não possui a figurinha buscada. O envio é opcional — o protocolo não exige resposta negativa.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"SEARCH_MISS"` |
| `message_id` | sim | UUID único da mensagem |
| `origin_peer_id` | sim | Nó que não possui a figurinha |
| `sender_peer_id` | sim | Nó que está enviando esta mensagem |
| `receiver_peer_id` | sim | Nó que iniciou a busca |
| `query_id` | sim | Mesmo `query_id` do SEARCH original |
| `sticker_id` | sim | Figurinha não encontrada |

## Exemplo

```json
{
  "type": "SEARCH_MISS",
  "message_id": "550e8400-e29b-41d4-a716-446655440005",
  "origin_peer_id": "ALUNO-05",
  "sender_peer_id": "ALUNO-05",
  "receiver_peer_id": "ALUNO-03",
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "sticker_id": "FIG-12"
}
```
