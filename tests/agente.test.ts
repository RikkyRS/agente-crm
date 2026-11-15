// =====================================================================
// Testes AUTOMÁTICOS do loop do agente (rodam no GitHub Actions a cada push).
//
// Aqui NÃO entra modelo de verdade nem CRM de verdade:
//   - o CRM é substituído por um mock (vi.mock) com 3 leads fixos
//   - o modelo é um "roteiro": uma lista de respostas que ele vai dar, em ordem
// Assim o teste é rápido (milissegundos), grátis e sempre dá o mesmo resultado.
// O que está sendo testado são as TRAVAS do nosso código, não a inteligência do modelo
// (essa é medida pelo `npm run avaliar`, com o modelo real).
// =====================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mensagem, Modelo } from "../src/agente.ts";

const LEADS = [
  { id: "11111111-1111-4111-8111-111111111111", nome: "Camila Rocha", telefone: "1", email: null, origem: "whatsapp", interesse: "Troca", status: "PROPOSTA", updatedAt: "2026-11-15" },
  { id: "22222222-2222-4222-8222-222222222222", nome: "Carlos Henrique Dias", telefone: "2", email: null, origem: "OLX", interesse: "Picape", status: "PROPOSTA", updatedAt: "2026-11-15" },
  { id: "33333333-3333-4333-8333-333333333333", nome: "Carlos Souza", telefone: "3", email: null, origem: "site", interesse: "SUV", status: "NOVO", updatedAt: "2026-11-15" },
];

vi.mock("../src/crm.ts", async (original) => {
  const real = await original<typeof import("../src/crm.ts")>();
  return {
    ...real, // mantém ETAPAS
    listarLeads: vi.fn(async ({ etapa, busca }: { etapa?: string; busca?: string }) =>
      LEADS.filter((l) => (!etapa || l.status === etapa) && (!busca || l.nome.toLowerCase().includes(busca.toLowerCase()))),
    ),
    buscarLead: vi.fn(async (id: string) => LEADS.find((l) => l.id === id)),
    moverLead: vi.fn(async (id: string, etapa: string) => ({ ...LEADS.find((l) => l.id === id)!, status: etapa })),
    criarLead: vi.fn(async () => {
      throw new Error("CRM respondeu 409: telefone já cadastrado");
    }),
  };
});

const crm = await import("../src/crm.ts");
const { rodarAgente, MAX_PASSOS } = await import("../src/agente.ts");

// Modelo falso: devolve as respostas do roteiro em ordem e guarda o que recebeu
function roteiro(...respostas: Mensagem[]) {
  const recebidas: Mensagem[][] = [];
  const modelo: Modelo = async (msgs) => {
    recebidas.push(structuredClone(msgs));
    return respostas.shift() ?? { role: "assistant", content: "fim" };
  };
  return { modelo, recebidas };
}
const chamar = (name: string, args: Record<string, unknown>): Mensagem => ({
  role: "assistant",
  content: "",
  tool_calls: [{ function: { name, arguments: args } }],
});
const texto = (content: string): Mensagem => ({ role: "assistant", content });
const ultimoResultado = (msgs: Mensagem[]) => JSON.parse(msgs.filter((m) => m.role === "tool").at(-1)!.content);

beforeEach(() => vi.clearAllMocks());

describe("loop do agente", () => {
  it("ferramenta de leitura executa SEM pedir confirmação", async () => {
    const { modelo } = roteiro(chamar("listar_leads", { etapa: "PROPOSTA" }), texto("2 leads"));
    const confirmar = vi.fn(async () => true);
    const r = await rodarAgente("quais em proposta?", confirmar, undefined, modelo);
    expect(confirmar).not.toHaveBeenCalled();
    expect(crm.listarLeads).toHaveBeenCalledWith(expect.objectContaining({ etapa: "PROPOSTA" }));
    expect(r.resposta).toBe("2 leads");
  });

  it("ação que altera dados pede confirmação mostrando nome e etapa atual", async () => {
    const { modelo } = roteiro(chamar("mover_lead", { lead: "Camila Rocha", etapa: "NEGOCIACAO" }), texto("feito"));
    const confirmar = vi.fn(async () => true);
    await rodarAgente("mova a Camila", confirmar, undefined, modelo);
    expect(confirmar).toHaveBeenCalledWith('mover "Camila Rocha" de PROPOSTA para NEGOCIACAO');
    expect(crm.moverLead).toHaveBeenCalledWith(LEADS[0].id, "NEGOCIACAO");
  });

  it("se o humano diz NÃO, nada é alterado e o modelo é avisado", async () => {
    const { modelo, recebidas } = roteiro(chamar("mover_lead", { lead: "Camila Rocha", etapa: "PERDIDO" }), texto("ok"));
    await rodarAgente("mova a Camila", async () => false, undefined, modelo);
    expect(crm.moverLead).not.toHaveBeenCalled();
    expect(ultimoResultado(recebidas[1])).toHaveProperty("cancelado");
  });

  it("lead inexistente: erro volta pro modelo e ninguém é perguntado", async () => {
    const { modelo, recebidas } = roteiro(chamar("mover_lead", { lead: "Fulano", etapa: "CLIENTE" }), texto("não achei"));
    const confirmar = vi.fn(async () => true);
    await rodarAgente("mova o Fulano", confirmar, undefined, modelo);
    expect(confirmar).not.toHaveBeenCalled();
    expect(crm.moverLead).not.toHaveBeenCalled();
    expect(ultimoResultado(recebidas[1]).erro).toMatch(/Nenhum lead/);
  });

  it("nome ambíguo (2 Carlos): pede pro modelo perguntar ao usuário", async () => {
    const { modelo, recebidas } = roteiro(chamar("mover_lead", { lead: "Carlos", etapa: "CLIENTE" }), texto("qual Carlos?"));
    await rodarAgente("mova o Carlos", async () => true, undefined, modelo);
    expect(crm.moverLead).not.toHaveBeenCalled();
    expect(ultimoResultado(recebidas[1]).erro).toMatch(/Mais de um lead/);
  });

  it("etapa inválida é barrada no código", async () => {
    const { modelo } = roteiro(chamar("mover_lead", { lead: "Camila Rocha", etapa: "FECHADO" }), texto("ok"));
    await rodarAgente("x", async () => true, undefined, modelo);
    expect(crm.moverLead).not.toHaveBeenCalled();
  });

  it("id inventado em buscar_lead é barrado antes de chamar a API", async () => {
    const { modelo, recebidas } = roteiro(chamar("buscar_lead", { id: "lead-123" }), texto("ok"));
    await rodarAgente("x", async () => true, undefined, modelo);
    expect(crm.buscarLead).not.toHaveBeenCalled();
    expect(ultimoResultado(recebidas[1]).erro).toMatch(/não é um id real/);
  });

  it("ferramenta que não existe (ex.: deletar_lead) vira erro, não executa nada", async () => {
    const { modelo, recebidas } = roteiro(chamar("deletar_lead", { id: LEADS[0].id }), texto("não posso"));
    await rodarAgente("apaga", async () => true, undefined, modelo);
    expect(ultimoResultado(recebidas[1]).erro).toMatch(/não existe/);
  });

  it("erro da API vira resultado da ferramenta (o programa não quebra)", async () => {
    const { modelo, recebidas } = roteiro(chamar("criar_lead", { nome: "João", telefone: "51 9999" }), texto("já existe"));
    const r = await rodarAgente("cadastra", async () => true, undefined, modelo);
    expect(ultimoResultado(recebidas[1]).erro).toMatch(/409/);
    expect(r.resposta).toBe("já existe");
  });

  it(`para depois de ${MAX_PASSOS} passos (sem loop infinito)`, async () => {
    const infinito: Modelo = async () => chamar("listar_leads", {});
    const r = await rodarAgente("x", async () => true, undefined, infinito);
    expect(crm.listarLeads).toHaveBeenCalledTimes(MAX_PASSOS);
    expect(r.resposta).toMatch(/limite de passos/);
  });
});
