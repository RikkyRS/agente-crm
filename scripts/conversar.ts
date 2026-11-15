// Uso:
//   npm run conversar                          → modo conversa (vários pedidos)
//   npm run conversar -- "quais leads estão em proposta?"   → um pedido só
//   --sim / --nao → responde a confirmação sozinho (pra demonstração e testes)
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { rodarAgente, SISTEMA, type Mensagem } from "../src/agente.ts";

const rl = readline.createInterface({ input: stdin, output: stdout });
const autoSim = process.argv.includes("--sim"); // pra demonstração: aprova sozinho
const autoNao = process.argv.includes("--nao"); // pra teste: recusa sozinho
const confirmar = async (acao: string) => {
  if (autoSim || autoNao) {
    console.log(`   ⚠️  O agente quer: ${acao} → ${autoSim ? "aprovado (--sim)" : "RECUSADO (--nao)"}`);
    return autoSim;
  }
  const r = await rl.question(`   ⚠️  O agente quer executar: ${acao}\n   Confirmar? (s/n) `);
  return r.trim().toLowerCase().startsWith("s");
};

async function atender(pedido: string, historico: Mensagem[]) {
  const t = Date.now();
  const { resposta, passos } = await rodarAgente(pedido, confirmar, historico);
  for (const p of passos) console.log(`   🔧 ${p.ferramenta}(${JSON.stringify(p.args)})`);
  console.log(`\n🤖 ${resposta}\n   ⏱️ ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
}

const historico: Mensagem[] = [{ role: "system", content: SISTEMA }];
const unico = process.argv.slice(2).filter((a) => a !== "--sim" && a !== "--nao").join(" ");
if (unico) {
  console.log(`\n🙋 ${unico}`);
  await atender(unico, historico);
} else {
  console.log("Agente do Pipeline CRM (sair = Ctrl+C)\n");
  for (;;) await atender(await rl.question("🙋 "), historico);
}
rl.close();
