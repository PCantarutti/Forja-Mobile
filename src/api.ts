import { fetch } from "expo/fetch";
import { Directory as Pasta, File as ArquivoLocal, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";

/** Pareamento lido do QR da aba Celular do Forja Desktop. */
export type Par = { url: string; token: string };

let par: Par | null = null;

export async function carregaPar(): Promise<Par | null> {
  const raw = await SecureStore.getItemAsync("forja");
  par = raw ? JSON.parse(raw) : null;
  return par;
}

export async function salvaPar(p: Par | null) {
  par = p;
  if (p) await SecureStore.setItemAsync("forja", JSON.stringify(p));
  else await SecureStore.deleteItemAsync("forja");
}

export const base = () => par?.url ?? "";

/** Sem tailnet (Tailscale do celular desligado, PC dormindo) o fetch ficava pendurado para sempre e a tela
 * mostrava "nenhuma conversa" em vez de um erro. O limite vale só até chegarem os cabeçalhos: o POST /run
 * responde com um SSE que não termina, e o long-poll do terminal pede um limite maior (`espera`). */
async function req<T>(path: string, init?: { method?: string; body?: unknown; espera?: number }): Promise<T> {
  const ac = new AbortController();
  const limite = setTimeout(() => ac.abort(), init?.espera ?? 12000);
  let r;
  try {
    r = await fetch(`${base()}/api${path}`, {
      method: init?.method ?? "GET",
      headers: { "Content-Type": "application/json", "X-Forja-Token": par?.token ?? "" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ac.signal,
    });
  } catch (e: any) {
    throw new Error(ac.signal.aborted ? "Sem resposta do PC. O Tailscale está ligado neste celular e no PC?" : e.message);
  } finally {
    clearTimeout(limite);
  }
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : null;
  // O status vai junto: alguns erros são perguntas (409 = VRAM ocupada, confirmar e repetir), não falhas.
  if (!r.ok) throw Object.assign(new Error(typeof dados?.detail === "string" ? dados.detail : `HTTP ${r.status}`), { status: r.status });
  return dados as T;
}

export const api = {
  get: <T>(path: string, espera?: number) => req<T>(path, { espera }),
  post: <T>(path: string, body?: unknown, espera?: number) => req<T>(path, { method: "POST", body, espera }),
  put: <T>(path: string, body: unknown) => req<T>(path, { method: "PUT", body }),
};

/** SSE lido por fetch (mesmo formato do frontend/src/api.ts: `data: {json}` + linha em branco). POST quando há `body`.
 * Um 409 vira erro com `status`, para a tela perguntar (ex.: descarregar a VRAM) e repetir com confirm. */
export async function streamSSE(path: string, onEvent: (ev: any) => void, signal: AbortSignal, body?: unknown) {
  const r = await fetch(`${base()}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Forja-Token": par?.token ?? "" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) {
    const d = await r.json().catch(() => ({}));
    throw Object.assign(new Error(d?.detail ?? `HTTP ${r.status}`), { status: r.status });
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const bloco = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const linha of bloco.split("\n"))
        if (linha.startsWith("data: ")) onEvent(JSON.parse(linha.slice(6)));
    }
  }
}

/** Arquivo do celular (DocumentPicker) como multipart `file`: anexo do chat (/uploads) ou referência de imagem. */
export async function enviaArquivo<T>(path: string, arq: { uri: string; name: string; mimeType?: string | null }): Promise<T> {
  // No SDK 57 o fetch global é o do Expo, que recusa o { uri, name, type } do React Native
  // ("Unsupported FormDataPart implementation"): a parte tem de ser um File do expo-file-system (tem bytes()).
  // O nome do multipart sai do próprio File, e o DocumentPicker copia para o cache com um UUID no nome:
  // uma cópia com o nome original é o que chega ao PC (e ao modelo) como "planilha.xlsx", não "4e01…".
  const pasta = new Pasta(Paths.cache, "envio");
  if (!pasta.exists) pasta.create();
  const envio = new ArquivoLocal(pasta, arq.name);
  if (envio.exists) envio.delete();
  await new ArquivoLocal(arq.uri).copy(envio);
  const fd = new FormData();
  fd.append("file", envio as any);
  let r;
  try { r = await fetch(`${base()}/api${path}`, { method: "POST", headers: { "X-Forja-Token": par?.token ?? "" }, body: fd as any }); }
  finally { if (envio.exists) envio.delete(); }
  const dados = await r.json().catch(() => null);
  // O status vai junto: alguns erros são perguntas (409 = VRAM ocupada, confirmar e repetir), não falhas.
  if (!r.ok) throw Object.assign(new Error(typeof dados?.detail === "string" ? dados.detail : `HTTP ${r.status}`), { status: r.status });
  return dados as T;
}

/** Ajustes dos inputs guardados no aparelho (o desktop guarda os dele no localStorage): modelo, esforço, opções de cada tela. */
export async function lerAjustes<T>(chave: string, padrao: T): Promise<T> {
  try { return { ...padrao, ...JSON.parse((await SecureStore.getItemAsync(`ajustes.${chave}`)) ?? "{}") }; }
  catch { return padrao; }
}
export const salvaAjustes = (chave: string, v: unknown) => SecureStore.setItemAsync(`ajustes.${chave}`, JSON.stringify(v)).catch(() => {});

/** O fetch do Expo cancelado não se chama AbortError ("Fetch request has been canceled"): conta como cancelamento. */
export const cancelado = (e: any) => e?.name === "AbortError" || /cancel|abort/i.test(String(e?.message ?? ""));

export const streamRun = (runId: string, cursor: number, onEvent: (ev: any) => void, signal: AbortSignal) =>
  streamSSE(`/runs/${runId}/stream?cursor=${cursor}`, onEvent, signal);

/** Imagem de rota com token como data URI. O <Image source={{ headers }}> do Android não mandava o header
 * (o /browser/shot levava 403), então a foto vem pelo fetch, que manda. Erro traz o `status` (503 = aba escondida). */
export async function imagemComToken(path: string): Promise<string> {
  const r = await fetch(`${base()}/api${path}`, { headers: { "X-Forja-Token": par?.token ?? "" } });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw Object.assign(new Error(d?.detail ?? `HTTP ${r.status}`), { status: r.status });
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${r.headers.get("content-type") ?? "image/jpeg"};base64,${btoa(bin)}`;
}

/** Imagem gerada ou de referência: rota sem token (main.py SEM_TOKEN). */
export const urlImagem = (path: string, v = "") =>
  `${base()}/api/local/image/file?path=${encodeURIComponent(path)}${v ? `&v=${encodeURIComponent(v)}` : ""}`;

export type Msg = {
  id: number; role: string; content: string | null; thinking?: string | null; name?: string | null;
  tool_calls?: { id: string; name: string; arguments: any }[] | null; tool_call_id?: string | null;
  status?: string | null; meta?: any;
};
// preview é objeto ({kind, path, text}) ou null — nunca renderizar direto num <Text>.
export type Aprovacao = {
  call: { id: string; name: string; arguments: any }; preview?: unknown; nota?: string | null;
  suggest?: string | null; questions?: unknown[]; plan?: string;
};
export type Live = {
  messages: Msg[];
  run: null | { run_id: string; cursor: number; draft: { content: string } | null; approvals: Aprovacao[] };
};
