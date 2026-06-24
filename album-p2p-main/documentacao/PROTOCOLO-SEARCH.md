# Protocolo: SEARCH

Busca uma figurinha específica na rede por inundação. O nó que recebe deve verificar o `query_id`; se já processou, descarta. Caso contrário, registra, verifica o inventário local e repassa com `ttl - 1`.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"SEARCH"` |
| `message_id` | sim | UUID único desta cópia da mensagem |
| `origin_peer_id` | sim | Nó que iniciou a busca |
| `sender_peer_id` | sim | Nó que está enviando esta cópia |
| `receiver_peer_id` | sim | Vizinho destinatário |
| `query_id` | sim | UUID único da busca — mesmo em todos os repasses |
| `ttl` | sim | Começa em 7 e decrementa a cada repasse |
| `sticker_id` | sim | Figurinha procurada |

## Exemplo — envio inicial

```json
{
  "type": "SEARCH",
  "message_id": "550e8400-e29b-41d4-a716-446655440002",
  "origin_peer_id": "ALUNO-03",
  "sender_peer_id": "ALUNO-03",
  "receiver_peer_id": "ALUNO-01",
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "ttl": 7,
  "sticker_id": "FIG-12"
}
```

## Exemplo — reenvio

```json
{
  "type": "SEARCH",
  "message_id": "550e8400-e29b-41d4-a716-446655440003",
  "origin_peer_id": "ALUNO-03",
  "sender_peer_id": "ALUNO-01",
  "receiver_peer_id": "ALUNO-05",
  "query_id": "550e8400-e29b-41d4-a716-446655440000",
  "ttl": 6,
  "sticker_id": "FIG-12"
}
```
