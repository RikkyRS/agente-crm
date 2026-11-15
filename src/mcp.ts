// =====================================================================
// MCP SERVER do Pipeline CRM
//
// MCP (Model Context Protocol) é um PADRÃO pra expor ferramentas pra IA.
// Em vez de cada app (Claude Code, Claude Desktop, Cursor...) ter o seu jeito
// de chamar ferramentas, eu escrevo o servidor uma vez e qualquer cliente MCP usa.
//
// Este arquivo NÃO tem modelo nenhum: quem pensa é o cliente (ex.: Claude Code).
// Aqui só ficam as ferramentas, reaproveitando as MESMAS de src/ferramentas.ts
// (mesma validação, mesma resolução nome → id).
//
// Transporte: stdio (o cliente abre este processo e conversa por stdin/stdout).
// Por isso NUNCA usar console.log aqui: stdout é do protocolo. Log vai pro stderr.
//
// Confirmação humana: no MCP quem pergunta "posso executar?" é o CLIENTE.
// As anotações readOnlyHint/destructiveHint avisam o cliente quais ferramentas mexem em dados.
// =====================================================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ETAPAS } from "./crm.ts";
import { porNome } from "./ferramentas.ts";

const server = new McpServer({ name: "pipeline-crm", version: "1.0.0" });

// Os mesmos parâmetros das ferramentas do agente, agora em Zod (o formato que o SDK pede)
const etapa = z.enum(ETAPAS);
const SCHEMAS: Record<string, z.ZodRawShape> = {
  listar_leads: {
    etapa: etapa.optional().describe("Filtra pela etapa do funil"),
    busca: z.string().optional().describe("Texto para buscar no nome, telefone ou e-mail"),
    limite: z.number().int().min(1).max(50).optional().describe("Máximo de leads (padrão 10)"),
  },
  buscar_lead: { id: z.string().describe("id do lead (vem de listar_leads)") },
  mover_lead: {
    lead: z.string().describe("Nome do lead (ex.: 'Camila Rocha') ou o id"),
    etapa: etapa.describe("Nova etapa"),
  },
  criar_lead: {
    nome: z.string(),
    telefone: z.string().describe("Com DDD"),
    interesse: z.string().optional(),
    origem: z.string().optional(),
  },
};

const resposta = (dados: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(dados, null, 2) }],
  isError,
});

for (const [nome, shape] of Object.entries(SCHEMAS)) {
  const f = porNome.get(nome)!;
  server.registerTool(
    nome,
    {
      description: f.definicao.function.description,
      inputSchema: shape,
      annotations: { readOnlyHint: !f.alteraDados, destructiveHint: false, openWorldHint: true },
    },
    async (args: Record<string, unknown>) => {
      try {
        const problema = f.validar?.(args);
        if (problema) return resposta({ erro: problema }, true);
        let final = args;
        if (f.preparar) {
          const prep = await f.preparar(args);
          if (prep.erro) return resposta({ erro: prep.erro }, true);
          final = prep.args ?? args;
        }
        return resposta(await f.executar(final));
      } catch (e) {
        return resposta({ erro: (e as Error).message }, true);
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error("MCP pipeline-crm pronto (stdio)");
