// =====================================================================
// Cliente HTTP do Pipeline CRM (a API real, publicada na Vercel).
// Usa o login de DEMONSTRAÇÃO: dados fictícios que voltam ao original
// a cada deploy. O agente nunca recebe senha nem token: só este arquivo
// fala com a API.
// =====================================================================

const BASE = process.env.CRM_URL ?? "https://user-management-api-gray.vercel.app";

export const ETAPAS = ["NOVO", "EM_ATENDIMENTO", "QUALIFICADO", "PROPOSTA", "NEGOCIACAO", "CLIENTE", "PERDIDO"] as const;
export type Etapa = (typeof ETAPAS)[number];

export type Lead = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  origem: string | null;
  interesse: string | null;
  status: Etapa;
  updatedAt: string;
};

// A API aceita a sessão como token Bearer: é o caminho que ela prevê para clientes
// de programa (scripts, CI). Cookie é para navegador, e aí ela exige Origin (proteção CSRF).
let token = "";

// Login de demonstração: a API devolve a sessão no cabeçalho Set-Cookie; guardamos só o token
async function garantirLogin() {
  if (token) return;
  const r = await fetch(`${BASE}/api/auth/demo`, { method: "POST" });
  if (!r.ok) throw new Error(`Login demo falhou: ${r.status}`);
  token = (r.headers.get("set-cookie") ?? "").split(";")[0].split("=").slice(1).join("=");
}

async function api<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  await garantirLogin();
  const r = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`CRM respondeu ${r.status}: ${JSON.stringify(corpo).slice(0, 200)}`);
  return corpo as T;
}

export async function listarLeads(filtros: { etapa?: Etapa; busca?: string; limite?: number }) {
  const p = new URLSearchParams({ limit: String(filtros.limite ?? 10) });
  if (filtros.etapa) p.set("status", filtros.etapa);
  if (filtros.busca) p.set("q", filtros.busca);
  const r = await api<{ data: Lead[]; total?: number }>(`/api/leads?${p}`);
  return r.data;
}

export const buscarLead = (id: string) => api<Lead>(`/api/leads/${id}`);

export const moverLead = (id: string, etapa: Etapa) =>
  api<Lead>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify({ status: etapa }) });

export const criarLead = (dados: { nome: string; telefone: string; interesse?: string; origem?: string }) =>
  api<Lead>(`/api/leads`, { method: "POST", body: JSON.stringify(dados) });
