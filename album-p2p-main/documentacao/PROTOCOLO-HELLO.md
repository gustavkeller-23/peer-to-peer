# Protocolo: HELLO

Anuncia a presença de um nó para um vizinho. Também carrega a lista de peers conhecidos para facilitar a descoberta da rede. O nó que entra manda um hello e espera que o vizinho que mando o hello, mande o hello a lista de peers.

## Campos

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | Valor fixo `"HELLO"` |
| `message_id` | sim | UUID único da mensagem |
| `sender_peer_id` | sim | ID do nó que está enviando |
| `peers` | não | Lista de endereços de peers conhecidos (backup) |

## Exemplo

```json
{
  "type": "HELLO",
  "message_id": "550e8400-e29b-41d4-a716-446655440001",
  "sender_peer_id": "ALUNO-23",
  "peers": ["192.168.1.10", "192.168.1.11"]
}
```
