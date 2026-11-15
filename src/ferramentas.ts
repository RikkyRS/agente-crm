// =====================================================================
// As FERRAMENTAS do agente.
// Cada ferramenta tem 3 partes:
//   1. definicao  → o que o MODELO vê: nome, descrição e JSON Schema dos parâmetros
//   2. alteraDados → se true, o agente PRECISA da confirmação humana antes de executar
//   3. executar   → o que o NOSSO código faz de verdade (o modelo nunca executa nada)
// =====================================================================
import { ETAPAS, buscarLead, criarLead, listarLeads, moverLead, type Etapa, type Lead } from "./crm.ts";

export type Ferramenta = {
  definicao: {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  };
  alteraDados: boolean;
  // Validação NO CÓDIGO, antes de pedir confirmação e antes de executar.
  // Devolve uma mensagem de erro (que o modelo vai ler) ou null se estiver ok.
  validar?: (args: Record<string, unknown>) => string | null;
  // Preparação NO CÓDIGO (pode consultar a API): transforma o que o modelo mandou
  // nos argumentos finais e gera a frase que o humano vai confirmar.
  preparar?: (args: Record<string, unknown>) => Promise<{ erro?: string; args?: Record<string, unknown>; descricao?: string }>;
  executar: (args: Record<string, unknown>) => Promise<unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exigirIdReal = (a: Record<string, unknown>) =>
  UUID.test(String(a.id ?? ""))
    ? null
    : `O id "${a.id}" não é um id real do CRM. Chame listar_leads com 'busca' (nome da pessoa) para obter o id correto e tente de novo.`;

// Devolver só o necessário: menos texto no prompt = mais barato e menos confusão
const resumir = (l: Lead) => ({
  id: l.id,
  nome: l.nome,
  etapa: l.status,
  interesse: l.interesse,
  origem: l.origem,
  atualizado_em: l.updatedAt?.slice(0, 10),
});

export const FERRAMENTAS: Ferramenta[] = [
  {
    definicao: {
      type: "function",
      function: {
        name: "listar_leads",
        description:
          "Lista leads do CRM. Use para perguntas como 'quais leads estão em proposta' ou 'procure o lead Fulano'.",
        parameters: {
          type: "object",
          properties: {
            etapa: { type: "string", enum: [...ETAPAS], description: "Filtra pela etapa do funil" },
            busca: { type: "string", description: "Texto para buscar no nome, telefone ou e-mail" },
            limite: { type: "integer", description: "Máximo de leads (padrão 10)" },
          },
          required: [],
        },
      },
    },
    alteraDados: false,
    executar: async (a) =>
      (await listarLeads({ etapa: a.etapa as Etapa, busca: a.busca as string, limite: a.limite as number })).map(resumir),
  },
  {
    definicao: {
      type: "function",
      function: {
        name: "buscar_lead",
        description: "Busca os detalhes de UM lead pelo id (o id vem do resultado de listar_leads).",
        parameters: {
          type: "object",
          properties: { id: { type: "string", description: "id do lead" } },
          required: ["id"],
        },
      },
    },
    alteraDados: false,
    validar: exigirIdReal,
    executar: async (a) => resumir(await buscarLead(String(a.id))),
  },
  {
    definicao: {
      type: "function",
      function: {
        name: "mover_lead",
        description:
          "Muda a etapa de um lead no funil (ex.: de PROPOSTA para NEGOCIACAO). Passe o NOME da pessoa em 'lead' (ou o id, se você já tiver).",
        parameters: {
          type: "object",
          properties: {
            lead: { type: "string", description: "Nome do lead (ex.: 'Camila Rocha') ou o id" },
            etapa: { type: "string", enum: [...ETAPAS], description: "Nova etapa" },
          },
          required: ["lead", "etapa"],
        },
      },
    },
    alteraDados: true,
    // Resolve o nome → id NO CÓDIGO, antes da confirmação: o humano confirma
    // vendo o nome real e a etapa atual, e o modelo não precisa adivinhar id nenhum.
    preparar: async (a) => {
      const alvo = String(a.lead ?? a.id ?? "").trim();
      if (!alvo) return { erro: "Informe o nome do lead em 'lead'." };
      if (!ETAPAS.includes(a.etapa as Etapa)) return { erro: `Etapa inválida. Use uma de: ${ETAPAS.join(", ")}` };
      let lead: Lead;
      if (UUID.test(alvo)) lead = await buscarLead(alvo);
      else {
        const achados = await listarLeads({ busca: alvo, limite: 5 });
        if (achados.length === 0) return { erro: `Nenhum lead encontrado com "${alvo}".` };
        if (achados.length > 1)
          return { erro: `Mais de um lead com "${alvo}": ${achados.map((l) => l.nome).join(", ")}. Pergunte ao usuário qual é.` };
        lead = achados[0];
      }
      return {
        args: { id: lead.id, etapa: a.etapa },
        descricao: `mover "${lead.nome}" de ${lead.status} para ${a.etapa}`,
      };
    },
    executar: async (a) => resumir(await moverLead(String(a.id), a.etapa as Etapa)),
  },
  {
    definicao: {
      type: "function",
      function: {
        name: "criar_lead",
        description: "Cadastra um lead novo no CRM.",
        parameters: {
          type: "object",
          properties: {
            nome: { type: "string" },
            telefone: { type: "string", description: "Com DDD, só números" },
            interesse: { type: "string", description: "O que a pessoa quer" },
            origem: { type: "string", description: "De onde veio: whatsapp, OLX, site..." },
          },
          required: ["nome", "telefone"],
        },
      },
    },
    alteraDados: true,
    executar: async (a) =>
      resumir(
        await criarLead({
          nome: String(a.nome),
          telefone: String(a.telefone).replace(/\D/g, ""),
          interesse: a.interesse as string | undefined,
          origem: a.origem as string | undefined,
        }),
      ),
  },
];

export const porNome = new Map(FERRAMENTAS.map((f) => [f.definicao.function.name, f]));
