# Sistema de Figurinhas P2P — ALUNO-12 / FIG-12

## Dependências

```bash
npm install
```

Instala: `ws` (WebSocket), `uuid`

---

## Como rodar

### Um nó (seu nó padrão — ALUNO-12)

```bash
node server.js 8080 ALUNO-12
```

O sistema abre três portas:
| Porta | Uso |
|-------|-----|
| 8080  | WebSocket P2P (recebe conexões de outros nós) |
| 8081  | WebSocket interno (frontend → servidor) |
| 8082  | HTTP com o frontend visual |

Acesse o frontend: **http://localhost:8082**

---

### Testar com dois nós locais

Terminal 1:
```bash
node server.js 8080 ALUNO-12
```

Terminal 2:
```bash
node server.js 8090 ALUNO-05
```

No frontend do ALUNO-12 (`http://localhost:8082`):
- IP: `127.0.0.1`
- Porta: `8090`
- Peer ID: `ALUNO-05`
- Clicar em **Conectar**

---

## Protocolo implementado

| Mensagem         | Status |
|------------------|--------|
| HELLO            | ✅ |
| SEARCH           | ✅ (com TTL e supressão de duplicatas) |
| SEARCH_HIT       | ✅ |
| SEARCH_MISS      | ✅ |
| TRADE_OFFER      | ✅ |
| TRADE_ACCEPT     | ✅ |
| TRADE_REJECT     | ✅ |
| TRANSFER_CONFIRM | ✅ |

### Regras implementadas

- Inventário inicial: **28 cópias** de FIG-12
- TTL padrão: **7**
- Identificador de busca: **UUID** aleatório
- Supressão de duplicatas via `query_id`
- Nenhum servidor central de busca
- Troca só ocorre se ambos tiverem disponibilidade
- Inventário nunca vai negativo

---

## Estrutura de arquivos

```
p2p-figurinhas/
├── server.js     ← Servidor P2P + WebSocket + HTTP
├── index.html    ← Frontend visual
├── FIG-12.PNG    ← (coloque aqui a sua figurinha)
└── README.md
```

---

## Interoperabilidade com outros grupos

Para que outros grupos se conectem ao seu nó:
- Compartilhe seu IP na rede local e use a **porta 8080**
- Todos devem usar `peer_id` no formato `ALUNO-XX`
- Formato de figurinha: `FIG-XX` ou `FIG-XX.PNG`

---

## Nota sobre as imagens das figurinhas

Coloque sua figurinha como `FIG-12.PNG` na pasta do projeto.  
Figurinhas de outros alunos ficam hospedadas nos respectivos servidores.  
O protocolo define a URL da imagem separadamente do protocolo de troca.