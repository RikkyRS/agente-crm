// Smoke test do MCP server: abre o servidor como um cliente MCP faria,
// lista as ferramentas e chama duas (sem alterar dados). Uso: npm run testar-mcp
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "teste", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["--no-warnings", "--env-file=.env", "src/mcp.ts"] }));

const { tools } = await client.listTools();
for (const t of tools) console.log(`🔧 ${t.name}  ${t.annotations?.readOnlyHint ? "(só leitura)" : "(ALTERA DADOS)"}`);

const r1 = await client.callTool({ name: "listar_leads", arguments: { etapa: "PROPOSTA" } });
console.log("\nlistar_leads(PROPOSTA) →", (r1.content as { text: string }[])[0].text.replace(/\s+/g, " ").slice(0, 160));

const r2 = await client.callTool({ name: "mover_lead", arguments: { lead: "Fulano Inexistente", etapa: "CLIENTE" } });
console.log("mover_lead(Fulano) → isError:", r2.isError, (r2.content as { text: string }[])[0].text.replace(/\s+/g, " "));

const r3 = await client.callTool({ name: "mover_lead", arguments: { lead: "Camila Rocha", etapa: "FECHADO" } });
console.log("mover_lead(etapa inválida) → isError:", r3.isError);
await client.close();
