Sistema de Figurinhas P2P
Cada aluno criará uma figurinha própria em formato PNG, e o sistema deverá permitir cadastrar figurinhas, consultar quais figurinhas um colega possui, buscar figurinhas na rede e realizar trocas entre pares.

Você pode baixar o template da figurinha aqui.

Visão Geral
Na primeira etapa, a descoberta de figurinhas deverá ser feita por inundação em uma rede P2P não estruturada. Cada grupo implementará seu sistema de forma independente, mas todos deverão seguir exatamente os padrões descritos abaixo para que seja possível realizar testes de interoperabilidade entre grupos.

Regras do trabalho
Cada aluno será o autor de 1 figurinha única, identificada por um código exclusivo. A distribuição inicial das posses deverá considerar que um aluno inicia com 28 cópias lógicas de sua figurinha, registradas no inventário do sistema, o arquivo da imagem ficará hospedado em uma URL específica.

O sistema deverá funcionar sem servidor central para busca de figurinhas. Na busca por inundação, uma consulta recebida por um nó deve ser repassada aos vizinhos, exceto ao remetente, até que o TTL chegue a zero ou a figurinha seja encontrada; além disso, mensagens repetidas devem ser ignoradas por meio de um identificador único de consulta.

Padrões obrigatórios
Todos os grupos deverão implementar os mesmos padrões abaixo.

Item	Padrão obrigatório
Arquitetura	Rede P2P não estruturada, sem servidor central de busca.
Transporte	WebSocket.
Formato das mensagens	JSON UTF-8.
Identificador do nó	peer_id no formato ALUNO-YY (ex.: ALUNO-02). Seguindo a lista de chamada
Identificador da figurinha	sticker_id no formato FIG-XX (ex.: FIG-12).
Nome do arquivo PNG	FIG-XX.
Porta de escuta	8080
Relógio lógico da busca	Campo ttl obrigatório em toda mensagem de busca. Padrão 7
Identificador da busca	Campo query_id obrigatório, globalmente único. UUID, gerar random
Prevenção de duplicatas	Cada nó deve manter histórico de query_id já processados.
Inventário	Lista das figurinhas possuídas pelo nó, com quantidade disponível para troca.
Além disso, cada nó deverá manter uma lista de vizinhos conectados e permitir configuração simples desses vizinhos por arquivo ou interface de entrada.

Protocolo de mensagens
Tipos mínimos de mensagem que todos os grupos deverão implementar:

HELLO: anuncia a presença de um nó para um vizinho.
SEARCH: busca uma figurinha específica na rede.
SEARCH_HIT: resposta positiva informando que a figurinha foi encontrada.
SEARCH_MISS: resposta opcional de não encontrada no nó local.
TRADE_OFFER: propõe uma troca.
TRADE_ACCEPT: aceita a troca proposta.
TRADE_REJECT: rejeita a troca proposta.
TRANSFER_CONFIRM: confirma a atualização do inventário após a troca.
Para a busca por inundação, o nó que recebe SEARCH deve verificar se já processou aquele query_id; se sim, descarta a mensagem, e se não, registra o identificador, verifica seu inventário e reenvia a consulta aos vizinhos com ttl - 1 quando ainda houver alcance disponível. Esse uso de TTL e supressão de duplicatas é um padrão clássico para limitar o espalhamento da busca e evitar retransmissões redundantes.

Regras de negócio
Cada nó deverá representar um aluno e manter localmente: sua figurinha autoral, seu inventário atual, a lista de vizinhos e o histórico de buscas e trocas. A figurinha autoral do aluno não precisa ser removida do disco após uma troca, mas o sistema deve controlar a quantidade disponível para troca no inventário, para que a negociação faça sentido.

Regras mínimas para a troca
Uma troca só pode ocorrer entre dois nós.
Cada proposta deve indicar claramente “ofereço” e “quero”.
Só é permitida troca se ambos os nós tiverem disponibilidade no inventário.
Ao concluir a troca, os dois nós devem atualizar seus inventários.
O sistema deve impedir inventário negativo.