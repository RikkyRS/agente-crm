// Demonstração pra gravar vídeo: digita os pedidos com efeito de digitação,
// roda o agente DE VERDADE contra o CRM no ar e responde a confirmação na tela.
// Uso: npm run demo
import { rodarAgente, SISTEMA, type Mensagem } from "../src/agente.ts";
import { moverLead } from "../src/crm.ts";

const C = { cinza: "\x1b[90m", verde: "\x1b[32m", amarelo: "\x1b[33m", ciano: "\x1b[36m", neg: "\x1b[1m", fim: "\x1b[0m" };
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function digitar(t: string, ms = 45) {
  for (const ch of t) {
    process.stdout.write(ch);
    await pausa(ms);
  }
}

const ROTEIRO: { pedido: string; resposta?: "s" | "n" }[] = [
  { pedido: "quais leads estão na etapa de proposta?" },
  { pedido: "mova a Camila Rocha para negociação", resposta: "s" },
  { pedido: "apaga o lead da Camila Rocha" },
];

console.clear();
console.log(`${C.neg}${C.ciano}Agente do Pipeline CRM${C.fim}  ${C.cinza}tool calling · confirmação humana · CRM real no ar${C.fim}\n`);
await pausa(1500);

const historico: Mensagem[] = [{ role: "system", content: SISTEMA }];
for (const passo of ROTEIRO) {
  process.stdout.write(`${C.neg}🙋 ${C.fim}`);
  await digitar(passo.pedido);
  process.stdout.write("\n");
  await pausa(600);
  process.stdout.write(`${C.cinza}   pensando...${C.fim}\n`);

  const confirmar = async (acao: string) => {
    process.stdout.write(`${C.amarelo}   ⚠️  O agente quer: ${acao}\n   Confirmar? (s/n) ${C.fim}`);
    await pausa(1200);
    await digitar(passo.resposta ?? "n", 200);
    process.stdout.write("\n");
    await pausa(500);
    return passo.resposta === "s";
  };

  const { resposta, passos } = await rodarAgente(passo.pedido, confirmar, historico);
  for (const p of passos) console.log(`${C.cinza}   🔧 ${p.ferramenta}(${JSON.stringify(p.args)})${C.fim}`);
  console.log(`\n${C.verde}🤖 ${resposta}${C.fim}\n`);
  await pausa(3500);
}

// Devolve o lead de demonstração ao estado original (fora da gravação)
await pausa(2500);
await moverLead("ec6f5dc6-fdca-4210-82d4-ae299bd54db1", "PROPOSTA");
