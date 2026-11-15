// =====================================================================
// O LOOP DO AGENTE (o coração do tool calling)
//
//   1. manda o histórico + a lista de ferramentas pro modelo
//   2. se o modelo pediu ferramenta(s):
//        - se altera dados → pergunta pro humano (confirmação)
//        - executa no NOSSO código e devolve o resultado como mensagem "tool"
//        - volta pro passo 1
//   3. se o modelo respondeu texto → é a resposta final
//
// Hoje o modelo é local (Ollama). Pra trocar pelo Claude, muda só chamarModelo().
// =====================================================================
import { FERRAMENTAS, porNome } from "./ferramentas.ts";

const MODELO = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const MAX_PASSOS = 6; // trava de segurança: o agente não pode ficar em loop infinito

export type Mensagem = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
};

export type Passo = { ferramenta: string; args: Record<string, unknown>; resultado: unknown; confirmado?: boolean };

export const SISTEMA = [
  "Você é um assistente que opera o Pipeline CRM de uma revenda de veículos, em português.",
  "Use as ferramentas para consultar ou alterar dados. Nunca invente leads, ids ou informações: se precisar de um id, use listar_leads antes.",
  "As etapas do funil são: NOVO, EM_ATENDIMENTO, QUALIFICADO, PROPOSTA, NEGOCIACAO, CLIENTE, PERDIDO.",
  "Para mudar a etapa de um lead, chame mover_lead passando o NOME da pessoa em lead (o sistema encontra o id).",
  "Para usar uma ferramenta, CHAME a ferramenta. Nunca escreva a chamada como texto na resposta.",
  "Se o pedido exigir algo que nenhuma ferramenta faz (ex.: apagar um lead), diga que não pode fazer isso. NUNCA substitua por outra ação parecida (ex.: mover para PERDIDO no lugar de apagar).",
  "Ações que alteram dados passam por confirmação humana; se o usuário recusar, não insista.",
  "Responda de forma curta e objetiva.",
].join("\n");

async function chamarModelo(mensagens: Mensagem[]) {
  const r = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELO,
      stream: false,
      options: { temperature: 0 },
      messages: mensagens,
      tools: FERRAMENTAS.map((f) => f.definicao),
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { message: Mensagem }).message;
}

export async function rodarAgente(
  pedido: string,
  confirmar: (descricao: string) => Promise<boolean>,
  historico: Mensagem[] = [{ role: "system", content: SISTEMA }],
) {
  historico.push({ role: "user", content: pedido });
  const passos: Passo[] = [];

  for (let i = 0; i < MAX_PASSOS; i++) {
    const resposta = await chamarModelo(historico);
    historico.push(resposta);

    // Sem pedido de ferramenta = resposta final
    if (!resposta.tool_calls?.length) return { resposta: resposta.content.trim(), passos, historico };

    for (const chamada of resposta.tool_calls) {
      const nome = chamada.function.name;
      let args = chamada.function.arguments ?? {};
      const ferramenta = porNome.get(nome);
      let resultado: unknown;

      let problema = ferramenta?.validar?.(args) ?? null;
      let descricao = `${nome}(${JSON.stringify(args)})`;
      if (ferramenta?.preparar && !problema) {
        try {
          const prep = await ferramenta.preparar(args);
          if (prep.erro) problema = prep.erro;
          else {
            args = prep.args ?? args;
            descricao = prep.descricao ?? descricao;
          }
        } catch (e) {
          problema = (e as Error).message;
        }
      }

      if (!ferramenta) {
        resultado = { erro: `Ferramenta '${nome}' não existe.` };
      } else if (problema) {
        // Argumento inválido: nem pergunta pro humano, devolve o erro pro modelo corrigir
        resultado = { erro: problema };
        passos.push({ ferramenta: nome, args, resultado, confirmado: false });
      } else if (ferramenta.alteraDados && !(await confirmar(descricao))) {
        // Humano disse não: avisamos o modelo, não executamos nada
        resultado = { cancelado: "O usuário NÃO autorizou esta ação. Não tente de novo." };
        passos.push({ ferramenta: nome, args, resultado, confirmado: false });
      } else {
        try {
          resultado = await ferramenta.executar(args);
        } catch (e) {
          resultado = { erro: (e as Error).message }; // o modelo vê o erro e pode corrigir
        }
        passos.push({ ferramenta: nome, args, resultado, confirmado: ferramenta.alteraDados || undefined });
      }
      historico.push({ role: "tool", content: JSON.stringify(resultado) });
    }
  }
  return { resposta: "Parei: o agente atingiu o limite de passos.", passos, historico };
}
