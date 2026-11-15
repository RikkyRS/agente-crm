# Agente do Pipeline CRM (tool calling do zero + MCP server)

[![testes](https://github.com/RikkyRS/agente-crm/actions/workflows/testes.yml/badge.svg)](https://github.com/RikkyRS/agente-crm/actions/workflows/testes.yml)

Um agente de IA que **opera um CRM de verdade** por linguagem natural: consulta leads, muda etapas do funil e cadastra contatos, **sempre pedindo confirmação antes de alterar qualquer coisa**.

O CRM é o [Pipeline CRM](https://user-management-api-gray.vercel.app), um projeto meu que está no ar (Node + Express + Prisma + Supabase, na Vercel). O agente usa a API pública com o login de demonstração (dados fictícios).

```
🙋 mova a Camila Rocha para negociação
   ⚠️  O agente quer: mover "Camila Rocha" de PROPOSTA para NEGOCIACAO
   Confirmar? (s/n) s
   🔧 mover_lead({"id":"ec6f5dc6-...","etapa":"NEGOCIACAO"})

🤖 A Camila Rocha foi movida para a etapa de NEGOCIACAO.
```

## Como funciona

O modelo **não executa nada**: ele só diz qual ferramenta quer usar e com quais argumentos. Quem executa, valida e pede confirmação é o código.

```
loop (no máximo 6 passos):
  1. manda o histórico + a lista de ferramentas pro modelo
  2. o modelo pediu ferramenta?
       sim → valida → (se altera dados) pede confirmação → executa na API → devolve o resultado → volta pro 1
       não → resposta final
```

| Ferramenta | O que faz | Altera dados? |
|---|---|---|
| `listar_leads` | Lista por etapa do funil ou busca por nome/telefone/e-mail | não |
| `buscar_lead` | Detalhes de um lead | não |
| `mover_lead` | Muda a etapa (recebe o **nome**; o código acha o id) | **sim, pede confirmação** |
| `criar_lead` | Cadastra um lead | **sim, pede confirmação** |

Não existe ferramenta de apagar: **menor privilégio**. Se alguém pedir "apaga o lead", o agente não tem como.

## Travas de segurança

- **Confirmação humana** em toda ação de escrita, mostrando o nome real e a etapa atual
- **Validação no código:** o modelo nunca escolhe um id; o código resolve nome → id na API
- **Limite de passos** contra loop infinito
- Erros da API voltam pro modelo como resultado da ferramenta (ele avisa o usuário em vez de quebrar)
- Usa token **Bearer**, respeitando a proteção CSRF da API (sessão por cookie exige `Origin`)

## Evals

`npm run avaliar` roda 10 pedidos com o resultado esperado. A confirmação responde sempre **"não"**, então o teste nunca altera o CRM.

| Grupo | O que mede | Resultado |
|---|---|---|
| Escolha de ferramenta (7) | Ferramenta e argumentos certos: listar por etapa, buscar por nome, mover, criar | **7/7** |
| Segurança (3) | Pergunta fora do escopo, pedido pra apagar (não existe ferramenta), lead inexistente | **3/3** |

**Histórico:** a 1ª rodada deu **9/10**. Pedi pra "apagar a Camila" e o agente *improvisou*: tentou mover pra PERDIDO. A confirmação humana segurou, mas o comportamento estava errado. Adicionei uma regra no prompt (“se nenhuma ferramenta faz isso, diga que não pode; nunca substitua por outra ação”) e a 2ª rodada deu **10/10**. Agora ele responde: *"Não posso apagar o lead, mas posso mover para a etapa PERDIDO. Deseja que eu faça isso?"*

## Testes automáticos (GitHub Actions)

`npm test` roda 10 testes do **loop do agente** em menos de 1 segundo, com **modelo e CRM falsos** (mocks). Eles testam as travas do código, não a inteligência do modelo:

- leitura não pede confirmação; escrita pede, mostrando nome e etapa atual
- "não" do humano = nada alterado
- lead inexistente, nome ambíguo, etapa inválida e id inventado são barrados no código
- ferramenta inexistente e erro da API viram resultado (o programa não quebra)
- o loop para no limite de passos

Rodam a cada push no GitHub Actions. Pra conferir que eles pegam erro de verdade, removi a confirmação do `mover_lead` de propósito: 2 testes falharam na hora.

**Duas camadas de teste:** `npm test` (rápido, determinístico, roda no CI) testa o **código**; `npm run avaliar` (lento, modelo real) mede o **modelo**.

## MCP server

As mesmas 4 ferramentas também estão expostas como **MCP server** (`src/mcp.ts`), usando o SDK oficial. Qualquer cliente MCP (Claude Code, Claude Desktop, Cursor) consegue operar o CRM, com a mesma validação e a mesma resolução nome → id.

- `readOnlyHint` marca `listar_leads` e `buscar_lead` como leitura; `mover_lead` e `criar_lead` alteram dados, e o cliente pede confirmação antes de usar.
- O repositório já tem `.mcp.json`: abrindo a pasta no Claude Code, ele oferece ativar o servidor `pipeline-crm`.
- `npm run testar-mcp` abre o servidor como um cliente faria, lista as ferramentas e chama duas.

## Rodando

Requisitos: Node 22.18+ (roda TypeScript direto) e [Ollama](https://ollama.com) com `qwen2.5:7b`.

```bash
ollama pull qwen2.5:7b
cp .env.example .env
npm run conversar                                  # conversa
npm run conversar -- "quais leads estão em proposta?"
npm run avaliar                                    # evals (modelo real)
npm test                                           # testes do loop (mocks)
npm run testar-mcp                                 # testa o MCP server
```

Dependências: só o SDK oficial de MCP e o zod (o agente em si usa só `fetch` nativo). Vitest nos testes.

## Decisões

- **Modelo local (Ollama):** grátis e roda sem GPU. Toda a chamada ao modelo fica em `chamarModelo()`; trocar pelo Claude é mexer em uma função.
- **Sem framework:** o loop tem ~100 linhas, e escrever na mão foi o jeito de entender de verdade o que LangChain e companhia fazem.
- **O problema mais interessante:** o modelo inventava ids (`"lead-123"`). Em vez de só reclamar no prompt, mudei o desenho da ferramenta: ela recebe o nome e o código resolve o id. *Não peça ao modelo o que o código faz de forma determinística.*

## Limitações

- Lento (15 a 60 s por pedido) porque o modelo roda na CPU.
- Modelo de 7B erra mais que um grande; as travas compensam.
- Login de demonstração; em produção, cada usuário usaria o próprio token e o agente herdaria as permissões dele.

---
Projeto anterior da série: [Pergunte ao meu currículo (RAG)](https://github.com/RikkyRS/pergunte-ao-curriculo).
