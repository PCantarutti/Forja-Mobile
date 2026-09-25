import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Keyboard, Modal, useWindowDimensions, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { api, type Aprovacao, enviaArquivo, lerAjustes, type Live, type Msg, salvaAjustes, streamRun } from "./api";
import { pergunta as dialogo } from "./Dialogo";
import { type Anexo, CartaoAnexo, ConvDoAnexo } from "./Anexo";
import { limpaConversa } from "./revoga";
import Entrada, { type Ajustes, type Contexto } from "./Entrada";
import { Abaixo, Cerebro, Cubo, Enviar, Escudo, Globo, Imagem, Lapis, Parar, Pasta as IconePasta, Relogio, Seta } from "./icones";
import Markdown, { Codigo } from "./Markdown";
import { LogoMarca } from "./Logo";
import Site, { type Servidor } from "./Site";
import { c, mono, s } from "./tema";

// Mesmas frases do desktop (MessageView.tsx, ACTION): a 1ª ferramenta do grupo abre o resumo.
const ACAO: Record<string, string> = {
  run_command: "Executou um comando", read_file: "Leu um arquivo", edit_file: "Editou um arquivo",
  write_file: "Escreveu um arquivo", list_dir: "Olhou a pasta", search: "Procurou no projeto",
  web_search: "Pesquisou na web", fetch_url: "Abriu uma página", delegate_task: "Delegou a um subagente",
  update_tasks: "Atualizou as tarefas", ask_user: "Perguntou ao usuário", run_task: "Despachou uma tarefa",
  plan_feature: "Planejou uma funcionalidade", browser_validate: "Validou uma página",
};


// Eventos que o Forja manda ao MODELO (desktop: NOTA_DO_AGENTE): não são conversa, vão dentro do grupo recolhível.
const NOTA: Record<string, string> = {
  goal: "Nova rodada da goal", aviso: "Aviso de segundo plano", contexto: "Contexto de execução",
  hook: "Hook do projeto", nudge: "Lembrete automático", skill: "Skill carregada",
  mudanca: "Mudança de modo ou modelo", referencia: "Conversa citada",
};

// Editar e enviar de novo (o lápis da mensagem do usuário). Sem provider = só leitura (Transcricao do Worker).
const Reenvio = createContext<{ rodando: boolean; reenvia: (id: number, texto: string) => void } | null>(null);

type Call = { id: string; name: string; arguments: any };
type Stats = { model?: string; tokens?: number; seconds?: number; tps?: number | null; estimated?: boolean };
type Peca = { tipo: "pensou"; id: string; texto: string } | { tipo: "tool"; id: string; call: Call } | { tipo: "nota"; id: string; titulo: string; texto: string };
type Seg =
  | { tipo: "user"; m: Msg }
  | { tipo: "texto"; m: Msg }
  | { tipo: "grupo"; id: string; pecas: Peca[] }
  | { tipo: "decisao"; id: string; call: Call }
  | { tipo: "evento"; m: Msg }
  | { tipo: "retry"; id: string; tentativa: string; erro: string; falhou: boolean }
  | { tipo: "stats"; id: string; s: Stats };

// Avisos de reconexão ao modelo (agent.py: "... Tentando de novo em 2.0s (2/5)..." e a compactação que falha
// junto): cada tentativa grava um evento, e na tela eles viram UM cartão que se atualiza e some ao conectar.
const TENTATIVA = /Tentando de novo.*\((\d+\/\d+)\)/;
const ehRetry = (m: Msg) => m.role === "event" && (TENTATIVA.test(m.content ?? "") ||
  (m.meta?.kind === "warning" && (m.content ?? "").startsWith("Falha ao compactar")));

/** Mensagens salvas -> segmentos na tela, como o groupActivity do desktop (MessageView.tsx). */
function segmentos(msgs: Msg[]): Seg[] {
  const out: Seg[] = [];
  // Caixa em vez de `let`: o TS não enxerga atribuição feita dentro das closures e travaria o tipo em null.
  const g: { atual: Extract<Seg, { tipo: "grupo" }> | null } = { atual: null };
  let notas: Peca[] = []; // avisos ao modelo esperando o próximo grupo abrir
  let turno: Stats[] = [];
  let retry: Extract<Seg, { tipo: "retry" }> | null = null; // cartão de reconexão aberto
  const conectou = () => { if (retry && !retry.falhou) out.splice(out.indexOf(retry), 1); retry = null; };
  const fecha = () => { if (g.atual) out.push(g.atual); g.atual = null; };
  const abre = (id: number) => {
    g.atual ??= { tipo: "grupo", id: `g${id}`, pecas: [] };
    g.atual.pecas.push(...notas);
    notas = [];
    return g.atual;
  };
  const fechaTurno = (id: number) => {
    if (notas.length) abre(id);
    fecha();
    if (!turno.length) return;
    const u = turno[turno.length - 1];
    out.push({ tipo: "stats", id: `s${id}`, s: { ...u, tokens: turno.reduce((a, t) => a + (t.tokens ?? 0), 0),
      seconds: turno.reduce((a, t) => a + (t.seconds ?? 0), 0) } });
    turno = [];
  };
  for (const m of msgs) {
    const kind = m.role === "event" ? String(m.meta?.kind ?? "") : "";
    if (m.role === "tool") continue; // resultado é desenhado dentro do grupo, não corta
    if (kind in NOTA) {
      const nota: Peca = { tipo: "nota", id: `n${m.id}`, titulo: NOTA[kind], texto: m.content ?? "" };
      if (g.atual) g.atual.pecas.push(nota);
      else notas.push(nota);
    } else if (ehRetry(m)) {
      if (!retry) { fecha(); retry = { tipo: "retry", id: `r${m.id}`, tentativa: "", erro: "", falhou: false }; out.push(retry); }
      const t = (m.content ?? "").match(TENTATIVA);
      if (t) { retry.tentativa = t[1]; retry.erro = (m.content ?? "").split(" Tentando de novo")[0]; }
    } else if (m.role === "user") { retry = null; fechaTurno(m.id); out.push({ tipo: "user", m }); }
    else if (m.role === "assistant") {
      conectou();
      if (m.meta?.stats) turno.push(m.meta.stats);
      if (notas.length && m.content && !m.thinking && !m.tool_calls?.length) abre(m.id);
      if (m.thinking) abre(m.id).pecas.push({ tipo: "pensou", id: `p${m.id}`, texto: m.thinking });
      if (m.content?.trim()) { fecha(); out.push({ tipo: "texto", m }); }
      for (const k of m.tool_calls ?? []) {
        // Plano e pergunta são decisão do usuário: nunca ficam escondidos no grupo.
        if (k.name === "exit_plan_mode" || k.name === "ask_user") { fecha(); out.push({ tipo: "decisao", id: `d${k.id}`, call: k }); }
        else abre(m.id).pecas.push({ tipo: "tool", id: k.id, call: k });
      }
    } else {
      if (retry && m.meta?.kind === "error") retry.falhou = true; // esgotou: fica o cartão + o erro final
      retry = null;
      fecha();
      out.push({ tipo: "evento", m });
    }
  }
  fechaTurno(-1);
  return out;
}

/** Última página que a IA abriu (browser_navigate) na porta do site: o celular abre direto nela, não na raiz. */
function ultimoCaminho(msgs: Msg[], urlServidor: string): string {
  const porta = urlServidor.match(/:(\d+)/)?.[1];
  for (let i = msgs.length - 1; i >= 0; i--)
    for (const k of msgs[i].tool_calls ?? []) {
      const u = String(k.arguments?.url ?? "");
      const at = k.name === "browser_navigate" && porta ? u.indexOf(`:${porta}/`) : -1;
      if (at >= 0) return u.slice(at + porta!.length + 1); // "/pomodoro.html?..." depois de ":PORTA"
    }
  return "";
}

const texto = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 1));

export type Conv = { id: number; title: string; kind?: string; workspace?: string | null; workspace_label?: string; pinned?: boolean };

/** Conversa ao vivo: mensagens salvas + SSE do run ativo, cards de aprovação e caixa de prompt.
 * Sem `conv` é uma conversa nova (tela "Como posso ajudar?"): ela nasce no backend no primeiro envio. */
/** Botão da skill gerar-imagens (resultado de `imagens_pendentes`): abre a conversa de Imagens do projeto. */
const AbreSlots = createContext<(toolMsgId: number) => void>(() => {});

export default function Chat({ conv, kind, workspace, onCriada, onTelaCheia, pasta, onPasta, onTurno, onAbreImagens }:
  { conv: Conv | null; kind: string; workspace?: string | null; onCriada: (c: Conv) => void; onTelaCheia: (sim: boolean) => void;
    pasta?: string; onPasta: () => void; onTurno: () => void; onAbreImagens?: (c: Conv) => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  // Tokens chegam um por evento; redesenhar a cada um travava o app (e o site aberto na aba ao lado).
  // Junta em lotes de ~80 ms.
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = (t: string) => {
    buffer.current += t;
    timer.current ??= setTimeout(() => {
      const lote = buffer.current;
      buffer.current = "";
      timer.current = null;
      setDraft((d) => d + lote);
    }, 80);
  };
  const zeraDraft = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    buffer.current = "";
    setDraft("");
  };
  const [aprov, setAprov] = useState<Aprovacao[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState("");
  const [perm, setPerm] = useState("manual");
  const [ajustes, setAjustes] = useState<Ajustes>({ provider: "", model: "", effort: "medio" });
  const [ctxVivo, setCtxVivo] = useState<{ usado: number; max: number; partes?: Contexto["partes"] } | null>(null); // evento `context` do run
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const lista = useRef<FlatList>(null);
  // Rolagem presa ao fim só enquanto o usuário está lá (como o useStickyBottom do desktop): expandir um grupo
  // ou ler lá em cima não é arrancado para baixo quando o conteúdo muda.
  const noFim = useRef(true);
  const arrastando = useRef(false);
  // Com edge-to-edge o Android não encolhe a janela para o teclado (e o KeyboardAvoidingView subia de menos):
  // a caixa sobe exatamente a altura que o sistema informa.
  const [teclado, setTeclado] = useState(0);
  useEffect(() => {
    const a = Keyboard.addListener("keyboardDidShow", (e) => setTeclado(e.endCoordinates.height));
    const b = Keyboard.addListener("keyboardDidHide", () => setTeclado(0));
    return () => { a.remove(); b.remove(); };
  }, []); // só a rolagem do dedo solta/prende o fim; conteúdo crescendo não conta
  const [longe, setLonge] = useState(false);
  const [sites, setSites] = useState<Servidor[]>([]);
  const [aba, setAba] = useState<"chat" | string>("chat"); // "chat" ou o nome do servidor aberto
  const buscaSites = useCallback(() => {
    api.get<{ servers: Servidor[] }>("/servers")
      .then((r) => setSites(r.servers.filter((x) => x.alive && x.url && String(x.conv) === String(convId))))
      .catch(() => {});
  }, [convId]);

  const segue = useCallback(async (id: string, cursor: number) => {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setRunId(id);
    try {
      await streamRun(id, cursor, (ev) => {
        if (ev.type === "context") setCtxVivo({ usado: ev.used ?? 0, max: ev.max ?? 0, partes: ev.partes ?? null });
        else if (ev.type === "assistant_start") zeraDraft();
        else if (ev.type === "token") token(ev.text);
        else if (ev.type === "assistant_end") { zeraDraft(); setMsgs((m) => [...m, ev.message]); }
        else if (ev.type === "tool_result" || ev.type === "event") {
          setMsgs((m) => [...m, ev.message]);
          if (ev.message?.name === "serve_start" || ev.message?.name === "run_command") buscaSites();
          if (ev.type === "tool_result") setAprov((a) => a.filter((x) => x.call.id !== ev.message.tool_call_id));
        } else if (ev.type === "approval_request" || ev.type === "plan_request" || ev.type === "question_request")
          setAprov((a) => [...a.filter((x) => x.call.id !== ev.call.id), { call: ev.call, preview: ev.preview ?? null,
            nota: ev.nota ?? null, suggest: ev.suggest ?? null, questions: ev.questions, plan: ev.plan }]);
      }, ac.signal);
    } catch (e: any) {
      if (!ac.signal.aborted) setErro(e.message);
    }
    if (!ac.signal.aborted) { setRunId(null); zeraDraft(); onTurno(); } // turno acabou: o título pode ter mudado
  }, [buscaSites]);

  const carrega = useCallback(async () => {
    if (convId == null) return setCarregado(true);
    buscaSites();
    try {
      const l = await api.get<Live>(`/conversations/${convId}/live`);
      setErro("");
      setMsgs(l.messages);
      setAprov(l.run?.approvals ?? []);
      setDraft(l.run?.draft?.content ?? "");
      if (l.run) segue(l.run.run_id, l.run.cursor);
      else setRunId(null);
    } catch (e: any) {
      setErro(e.message);
    }
    setCarregado(true);
  }, [convId, segue, buscaSites]);

  useEffect(() => {
    carrega();
    // Ajustes salvos no aparelho; sem nada salvo, os do último turno (o que o desktop estava usando).
    api.get<{ defaults: Record<string, string> }>("/mobile").then(async ({ defaults: d }) => {
      if (d.permission) setPerm(d.permission);
      setAjustes(await lerAjustes<Ajustes>("modelo", { provider: d.provider ?? "", model: d.model ?? "", effort: d.effort ?? "medio" }));
    }).catch(() => {});
    // Voltou do segundo plano: o SSE provavelmente morreu com o app suspenso; recarrega do /live.
    const sub = AppState.addEventListener("change", (st) => st === "active" && carrega());
    return () => { sub.remove(); abort.current?.abort(); };
  }, [carrega]);

  /** Conversa nova nasce no backend no primeiro envio (ou no primeiro anexo, que precisa da pasta dela). */
  async function garanteConv(): Promise<number> {
    if (convId != null) return convId;
    const nova = await api.post<Conv>("/conversations", { kind, workspace: workspace || undefined });
    onCriada(nova);
    idNovo.current = nova.id;
    return nova.id;
  }
  const idNovo = useRef<number | null>(null);
  const semPasta = (kind === "agent" || kind === "maestro") && convId == null && !idNovo.current && !workspace;

  async function anexar() {
    if (semPasta) return setErro("Escolha uma pasta de trabalho antes de anexar: o anexo vai para dentro dela.");
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }).catch(() => null);
    if (!r || r.canceled) return;
    setEnviando(true);
    try {
      const id = idNovo.current ?? (await garanteConv());
      for (const a of r.assets) {
        const up = await enviaArquivo<Anexo>(`/uploads?conv=${id}`, { uri: a.uri, name: a.name, mimeType: a.mimeType });
        setAnexos((x) => [...x, { ...up, local: a.uri }]); // local: a prévia da imagem antes de chegar ao PC
      }
    } catch (e: any) { setErro(e.message); }
    setEnviando(false);
  }

  async function mudaAjustes(a: Ajustes, gguf?: string) {
    if (!gguf) { setAjustes(a); salvaAjustes("modelo", a); return; }
    // .gguf: como o ModelPicker do desktop, carrega na GPU e usa o alias que o servidor devolve.
    dialogo("Carregar modelo", `Carregar ${a.model} na GPU? O modelo atual é descarregado.`, [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Carregar", acao: async () => {
        try {
          const r = await api.post<{ alias?: string }>("/local/load", { path: gguf, params: {} }, 300000);
          const novo = { ...a, provider: "local", model: r.alias || a.model };
          setAjustes(novo);
          salvaAjustes("modelo", novo);
        } catch (e: any) { setErro(e.message); }
      } },
    ]);
  }

  async function envia(content: string) {
    try {
      if (runId) return void (await api.post(`/runs/${runId}/queue`, { content }));
      if (!ajustes.model) throw new Error("Escolha um modelo no botão de modelo, embaixo da caixa.");
      if (semPasta) throw new Error("Escolha uma pasta de trabalho antes de enviar (toque em \"Escolher pasta\").");
      noFim.current = true;
      setMsgs((m) => [...m, { id: -Date.now(), role: "user", content, meta: anexos.length ? { attachments: anexos } : undefined }]);
      const id = idNovo.current ?? (await garanteConv());
      const vai = anexos;
      setAnexos([]);
      roda(id, content, vai);
      // Conversa nova: trocar o convId recria o `carrega`, e o efeito dele puxa o /live com o run.
      if (id !== convId) setTimeout(() => setConvId(id), 700);
      else setTimeout(carrega, 700);
    } catch (e: any) {
      setErro(e.message);
    }
  }

  /** O POST /run devolve o SSE; basta disparar e seguir pelo /live, que já traz o run_id. */
  function roda(id: number, content: string, vai: Anexo[] = []) {
    api.post(`/conversations/${id}/run`, { provider: ajustes.provider, model: ajustes.model, permission: kind === "chat" ? "manual" : perm,
      effort: kind === "maestro" && ajustes.effort === "extremo" ? "maximo" : ajustes.effort, content,
      attachments: vai.map(({ local: _l, ...a }) => a) }).catch(() => {}); // o caminho do celular não vai para o PC
  }

  /** Editar e enviar de novo: apaga da mensagem em diante e roda com o texto novo (rewindAndRun do desktop).
   *  Se os turnos apagados mexeram em arquivos, pergunta se desfaz também. */
  const reenvia = useCallback(async (mid: number, content: string) => {
    if (convId == null || runId) return;
    if (!ajustes.model) return setErro("Escolha um modelo no botão de modelo, embaixo da caixa.");
    const vai = async (restore_files: boolean) => {
      try {
        const r = await api.post<{ messages: Msg[] }>(`/conversations/${convId}/rewind`, { message_id: mid, keep: false, restore_files });
        noFim.current = true;
        setMsgs([...r.messages, { id: -Date.now(), role: "user", content }]);
        roda(convId, content);
        setTimeout(carrega, 700);
      } catch (e: any) { setErro(e.message); }
    };
    const cps = await api.get<Record<string, string[]>>(`/conversations/${convId}/checkpoints`).catch(() => ({}));
    const arquivos = new Set(Object.entries(cps).filter(([t]) => Number(t) >= mid).flatMap(([, f]) => f));
    if (!arquivos.size) return vai(false);
    dialogo("Editar e enviar de novo", `Os turnos apagados alteraram ${arquivos.size} arquivo(s). Desfazer essas alterações também?`, [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Manter arquivos", acao: () => vai(false) },
      { texto: "Desfazer", acao: () => vai(true) },
    ]);
  }, [convId, runId, ajustes, kind, perm, carrega]);
  const reenvio = useMemo(() => ({ rodando: !!runId, reenvia }), [runId, reenvia]);

  async function trocaPerm(p: string) {
    setPerm(p);
    if (runId) await api.post(`/runs/${runId}/permission`, { permission: p }).catch((e) => setErro(e.message));
  }

  async function decide(a: Aprovacao, body: Record<string, unknown>, regra?: boolean) {
    try {
      if (regra && a.suggest) {
        // "Sempre permitir": a mesma regra que o desktop grava em Configurações › Permissões.
        const campo = a.call.name === "run_command" ? "auto_approve_commands" : "auto_approve_tools";
        const st = await api.get<any>("/settings");
        const atuais: string[] = st[campo] ?? [];
        if (!atuais.includes(a.suggest)) await api.put("/settings", { [campo]: [...atuais, a.suggest] });
      }
      await api.post(`/runs/${runId}/approve`, { call_id: a.call.id, ...body });
      setAprov((x) => x.filter((y) => y.call.id !== a.call.id));
    } catch (e: any) {
      setErro(e.message);
    }
  }

  const resultados = useMemo(() => new Map(msgs.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m])), [msgs]);
  const segs = useMemo(() => segmentos(msgs), [msgs]);
  // Últimos N blocos desenhados de uma vez: com virtualização a lista só media ~10 itens e o "ir para o fim"
  // parava no meio. O histórico antigo entra pelo botão do topo.
  const [limite, setLimite] = useState(60);
  const visiveis = useMemo(() => segs.slice(-limite), [segs, limite]);
  const pendentes = useMemo(() => new Set(aprov.map((a) => a.call.id)), [aprov]);
  // Anel de contexto: as mesmas contas do desktop (App.tsx, summary). Usado = prompt + saída da última resposta
  // (é o que entra na próxima requisição); durante o run, o evento `context`.
  const ctx = useMemo<Contexto | null>(() => {
    const todas = msgs.flatMap((m) => (m.role === "assistant" && m.meta?.stats ? [m.meta.stats] : []));
    const ult = todas[todas.length - 1];
    const max = ctxVivo?.max || ult?.ctx_max || 0;
    if (!max) return null;
    const usado = runId && ctxVivo ? ctxVivo.usado : ult ? (ult.prompt_tokens ?? 0) + (ult.tokens ?? 0) : ctxVivo?.usado ?? 0;
    const comTps = todas.filter((x) => x.tps != null);
    const comCache = todas.filter((x) => x.cached != null);
    const promptCache = comCache.reduce((n, x) => n + (x.prompt_tokens ?? 0), 0);
    return {
      usado, max, partes: ctxVivo?.partes ?? ult?.partes ?? null, saida: ult?.tokens ?? null,
      media: comTps.length ? comTps.reduce((n, x) => n + x.tps, 0) / comTps.length : null,
      sessao: { turnos: msgs.filter((m) => m.role === "user").length, passos: todas.length,
        tokens: todas.reduce((n, x) => n + (x.prompt_tokens ?? 0) + (x.tokens ?? 0), 0),
        cache: promptCache ? comCache.reduce((n, x) => n + (x.cached ?? 0), 0) / promptCache : null },
    };
  }, [msgs, ctxVivo, runId]);

  // Cria (ou reaproveita) a conversa de Imagens do projeto com os slots; gerar é lá, com o modelo de imagem.
  const abreSlots = useCallback((mid: number) => {
    api.post<Conv>(`/imagens/slots/${mid}/conversa`, {})
      .then((c) => onAbreImagens?.({ ...c, title: c.title ?? "Imagens do site" }))
      .catch((e) => setErro(e.message));
  }, [onAbreImagens]);

  // Notificação de pedido que não está mais esperando (decidido no desktop, turno parado) sai daqui ao abrir.
  useEffect(() => {
    if (convId != null && carregado) limpaConversa(convId, aprov.map((a) => a.call.id)).catch(() => {});
  }, [convId, carregado, aprov]);

  function compactar() {
    if (convId == null) return;
    // Usa o modelo para resumir o histórico antigo: confirma antes (pode carregar a GPU).
    dialogo("Compactar agora", `O histórico antigo vira um resumo feito por ${ajustes.model || "o modelo"}, e a janela de contexto fica livre.`, [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Compactar", acao: async () => {
        try {
          const r = await api.post<{ messages?: Msg[] }>(`/conversations/${convId}/compact`, { provider: ajustes.provider, model: ajustes.model }, 300000);
          if (r?.messages) setMsgs(r.messages); else carrega();
        } catch (e: any) { dialogo("Compactar agora", e.message, [{ texto: "Ok" }]); } // no rodapé da lista o erro ficava fora da tela
      } },
    ]);
  }
  const { width, height } = useWindowDimensions();
  const siteAberto = aba !== "chat" && sites.some((x) => x.name === aba);
  const telaCheia = siteAberto && width > height; // site deitado ocupa a tela inteira
  useEffect(() => { onTelaCheia(telaCheia); }, [telaCheia]);

  if (!carregado) return <View style={[s.tela, { justifyContent: "center" }]}><ActivityIndicator color={c.muted} /></View>;
  return (
    <View style={{ flex: 1 }}>
    {sites.length > 0 && !telaCheia && (
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomColor: c.line, borderBottomWidth: 1 }}>
        {[{ id: "chat", rotulo: "Chat" }, ...sites.map((x) => ({ id: x.name, rotulo: x.name }))].map((t) => (
          <Pressable key={t.id} onPress={() => setAba(t.id)}
                     style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                              backgroundColor: aba === t.id ? c.raised : "transparent" }}>
            {t.id !== "chat" && <Globo size={13} color={aba === t.id ? c.fg : c.muted} />}
            <Text style={{ color: aba === t.id ? c.fg : c.muted, fontSize: 14 }} numberOfLines={1}>{t.rotulo}</Text>
          </Pressable>
        ))}
      </View>
    )}
    {siteAberto && <Site nome={aba} caminho={ultimoCaminho(msgs, sites.find((x) => x.name === aba)!.url)} />}
    <View style={{ flex: 1, paddingBottom: teclado, display: siteAberto ? "none" : "flex" }}>
      <ConvDoAnexo.Provider value={convId}>
      <AbreSlots.Provider value={abreSlots}>
      <Reenvio.Provider value={reenvio}>
      <FlatList
        ref={lista}
        data={visiveis}
        initialNumToRender={visiveis.length}
        keyboardShouldPersistTaps="handled" // com o teclado aberto, o 1º toque em "Enviar de novo" só fechava o teclado
        windowSize={31}
        ListHeaderComponent={segs.length > limite ? (
          <Pressable onPress={() => { noFim.current = false; setLimite((l) => l + 60); }} style={[s.btnSec, { alignSelf: "center" }]}>
            <Text style={s.btnSecTxt}>Mostrar anteriores</Text>
          </Pressable>
        ) : null}
        keyExtractor={(x) => ("m" in x ? `${x.tipo}${x.m.id}` : x.id)}
        // No 1º desenho a lista ainda não mediu a própria altura e o scrollToEnd não faz nada: repete no
        // onLayout e no quadro seguinte.
        onContentSizeChange={() => noFim.current && requestAnimationFrame(() => lista.current?.scrollToEnd({ animated: false }))}
        onLayout={() => noFim.current && requestAnimationFrame(() => lista.current?.scrollToEnd({ animated: false }))}
        onScrollBeginDrag={() => { arrastando.current = true; }}
        onMomentumScrollEnd={() => { arrastando.current = false; }}
        onScroll={({ nativeEvent: e }) => {
          if (!arrastando.current) return;
          noFim.current = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 80;
          setLonge(!noFim.current);
        }}
        scrollEventThrottle={100}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 14, flexGrow: visiveis.length ? 0 : 1 }}
        ListEmptyComponent={draft || runId ? null : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 18 }}>
            <LogoMarca size={56} color={c.muted} />
            <Text style={{ color: c.fg, fontSize: 24, fontWeight: "600" }}>Como posso ajudar?</Text>
            {!!pasta && convId == null && (
              <Pressable onPress={onPasta} style={{ flexDirection: "row", alignItems: "center", gap: 7, borderColor: semPasta ? "#78350f" : c.line,
                                                    borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface }}>
                <IconePasta size={15} color={semPasta ? "#fcd34d" : c.muted} />
                <Text style={{ color: semPasta ? "#fcd34d" : c.fg, fontSize: 14 }} numberOfLines={1}>{pasta}</Text>
                <Abaixo size={14} color={c.faint} />
              </Pressable>
            )}
          </View>
        )}
        renderItem={({ item }) => <Segmento seg={item} resultados={resultados} pendentes={pendentes} />}
        ListFooterComponent={
          <View style={{ gap: 14, marginTop: segs.length ? 14 : 0 }}>
            {!!draft && <Markdown texto={draft} />}
            {runId && !draft && !aprov.length && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color={c.faint} /><Text style={s.faint}>Trabalhando…</Text>
              </View>
            )}
            {aprov.map((a) => <CardAprovacao key={a.call.id} a={a} onDecide={decide} />)}
            {/* log do llama-server tem dezenas de linhas: as primeiras bastam; tocar limpa */}
            {!!erro && <Text style={[s.muted, { color: c.red }]} numberOfLines={4} onPress={() => setErro("")}>{erro}</Text>}
          </View>
        }
      />
      </Reenvio.Provider>
      </AbreSlots.Provider>
      </ConvDoAnexo.Provider>
      {longe && (
        <Pressable onPress={() => { noFim.current = true; setLonge(false); lista.current?.scrollToEnd({ animated: true }); }}
                   style={{ position: "absolute", right: 16, bottom: 118, width: 38, height: 38, borderRadius: 19,
                            backgroundColor: c.raised, borderColor: c.line, borderWidth: 1, alignItems: "center", justifyContent: "center" }}>
          <Abaixo size={18} />
        </Pressable>
      )}
      <Entrada kind={kind} conv={convId} teclado={teclado > 0} rodando={!!runId} perm={perm} onPerm={trocaPerm} onEnvia={envia}
               ajustes={ajustes} onAjustes={mudaAjustes} ctx={ctx} podeCompactar={!runId && convId != null} onCompactar={compactar} anexos={anexos} enviando={enviando} onAnexar={anexar}
               onTiraAnexo={(pth) => setAnexos((x) => x.filter((a) => a.path !== pth))}
             onPara={() => runId && api.post(`/runs/${runId}/stop`).catch((e) => setErro(e.message))} />
    </View>
    </View>
  );
}

// memo: o rascunho muda a cada token, e sem isso a lista inteira (Markdown incluso) redesenhava junto.
const Segmento = memo(function Segmento({ seg, resultados, pendentes }: { seg: Seg; resultados: Map<any, Msg>; pendentes: Set<string> }) {
  if (seg.tipo === "user") return <MsgUsuario m={seg.m} />;
  if (seg.tipo === "texto") return <Markdown texto={seg.m.content ?? ""} />;
  if (seg.tipo === "evento") return <Evento m={seg.m} />;
  if (seg.tipo === "stats") return <LinhaStats s={seg.s} />;
  if (seg.tipo === "retry")
    return (
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center", borderColor: seg.falhou ? "#7f1d1d" : c.line, borderWidth: 1,
                     borderRadius: 16, backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 10 }}>
        {!seg.falhou && <ActivityIndicator size="small" color={c.muted} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: seg.falhou ? "#fecaca" : c.fg, fontSize: 13.5 }}>
            {seg.falhou ? `Não conectou ao modelo${seg.tentativa ? ` depois de ${seg.tentativa.split("/")[1]} tentativas` : ""}`
                        : `Reconectando ao modelo${seg.tentativa ? ` · tentativa ${seg.tentativa}` : ""}`}
          </Text>
          {!!seg.erro && !seg.falhou && <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={3}>{seg.erro}</Text>}
        </View>
      </View>
    );
  if (seg.tipo === "decisao") return <Decisao call={seg.call} r={resultados.get(seg.call.id)} pendente={pendentes.has(seg.call.id)} />;
  return <Grupo pecas={seg.pecas} resultados={resultados} pendentes={pendentes} />;
});

/** Mensagem do usuário. O lápis fica sempre à vista (no toque não há hover) e edita no lugar, como no desktop. */
function MsgUsuario({ m }: { m: Msg }) {
  const r = useContext(Reenvio);
  const [texto, setTexto] = useState<string | null>(null); // null = não está editando
  if (texto !== null)
    return (
      <View style={{ alignSelf: "stretch", gap: 10, borderColor: c.line, borderWidth: 1, borderRadius: 22, backgroundColor: c.surface, padding: 12 }}>
        <TextInput value={texto} onChangeText={setTexto} multiline autoFocus style={[s.txt, { maxHeight: 220, padding: 4 }]}
                   placeholderTextColor={c.faint} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Pressable onPress={() => setTexto(null)} style={s.btnSec}><Text style={s.btnSecTxt}>Cancelar</Text></Pressable>
          <Pressable disabled={!texto.trim() || r?.rodando} style={[s.btn, (!texto.trim() || r?.rodando) && { opacity: 0.4 }]}
                     onPress={() => { const t = texto.trim(); setTexto(null); r?.reenvia(m.id, t); }}>
            <Text style={s.btnTxt}>Enviar de novo</Text>
          </Pressable>
        </View>
      </View>
    );
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "88%", gap: 6, alignItems: "flex-end" }}>
        {!!m.meta?.attachments?.length && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
            {m.meta.attachments.map((a: Anexo) => <CartaoAnexo key={a.path} a={a} />)}
          </View>
        )}
        {!!m.content && (
          <View style={{ backgroundColor: c.raised, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={s.txt} selectable>{m.content}</Text>
          </View>
        )}
      {r && m.id > 0 && !!m.content && (
        <Pressable onPress={() => setTexto(m.content ?? "")} disabled={r.rodando} hitSlop={10} accessibilityLabel="Editar e enviar de novo"
                   style={{ padding: 4, opacity: r.rodando ? 0.3 : 1 }}>
          <Lapis size={15} color={c.faint} />
        </Pressable>
      )}
    </View>
  );
}

const EVENTO: Record<string, [string, string, string]> = { // título, borda, texto (EventNotice do desktop)
  warning: ["Aviso", "#78350f", "#fde68a"], error: ["Erro", "#7f1d1d", "#fecaca"], imagens: ["Imagens do site", c.line, c.muted],
  nudge: ["Lembrete automático ao modelo", "#0c4a6e", "#bae6fd"], info: ["Info", c.line, c.muted],
};

/** Evento da conversa: resumo de compactação recolhido; aviso/erro/info em cartão com título. */
function Evento({ m }: { m: Msg }) {
  const [aberto, setAberto] = useState(false);
  const kind = String(m.meta?.kind ?? "info");
  if (kind === "summary")
    return (
      <View style={{ borderColor: c.line, borderWidth: 1, borderRadius: 16, backgroundColor: c.surface }}>
        <Pressable onPress={() => setAberto(!aberto)} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12 }}>
          <Text style={[s.muted, { flex: 1 }]}>Contexto compactado: o histórico anterior foi resumido para caber na janela do modelo</Text>
          {aberto ? <Abaixo size={14} color={c.faint} /> : <Seta size={14} color={c.faint} />}
        </Pressable>
        {aberto && <View style={{ borderTopColor: c.line, borderTopWidth: 1, padding: 12 }}><Markdown texto={m.content ?? ""} /></View>}
      </View>
    );
  if (kind === "tasks")
    return (
      <View style={{ borderColor: c.line, borderWidth: 1, borderRadius: 16, backgroundColor: c.surface, padding: 12, gap: 4 }}>
        <Text style={s.secao}>Tarefas</Text>
        {(m.meta?.tasks ?? []).map((t: any, i: number) => (
          <Text key={i} style={[s.muted, t.status === "completed" && { textDecorationLine: "line-through", color: c.faint }]}>
            {t.status === "completed" ? "✓" : t.status === "in_progress" ? "›" : "○"} {t.content ?? t.title ?? texto(t)}
          </Text>
        ))}
      </View>
    );
  const [titulo, borda, cor] = EVENTO[kind] ?? EVENTO.info;
  return (
    <View style={{ borderColor: borda, borderWidth: 1, borderRadius: 16, backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 10 }}>
      <Text style={{ color: cor, fontSize: 13.5, lineHeight: 20 }} selectable>
        <Text style={{ fontWeight: "600" }}>{titulo}:</Text> {m.content}
      </Text>
    </View>
  );
}

/** Plano ou pergunta já decididos: ficam à vista, recolhidos numa linha com o desfecho. */
function Decisao({ call, r, pendente }: { call: Call; r?: Msg; pendente: boolean }) {
  const [aberto, setAberto] = useState(false);
  if (pendente) return null; // o card de aprovação no fim da conversa cuida dele
  const plano = call.name === "exit_plan_mode";
  const titulo = plano ? (r?.meta?.approved ? "Plano aprovado" : r ? "Plano não aprovado" : "Plano")
                       : "Pergunta respondida";
  return (
    <View style={{ borderColor: c.line, borderWidth: 1, borderRadius: 14, overflow: "hidden" }}>
      <Pressable onPress={() => setAberto(!aberto)} style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 12 }}>
        <Text style={[s.muted, { flex: 1 }]}>{titulo}</Text>
        {aberto ? <Abaixo size={14} color={c.faint} /> : <Seta size={14} color={c.faint} />}
      </Pressable>
      {aberto && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
          <Markdown texto={plano ? texto(call.arguments?.plan) : texto(call.arguments?.question ?? call.arguments?.questions?.map((q: any) => q.question).join("\n\n"))} />
          {!!r?.content && !plano && <Text style={[s.muted, { fontStyle: "italic" }]}>{r.content}</Text>}
        </View>
      )}
    </View>
  );
}

function LinhaStats({ s: st }: { s: Stats }) {
  const seg = st.seconds ?? 0;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      {!!st.model && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: c.raised, borderRadius: 6,
                       paddingHorizontal: 7, paddingVertical: 2, maxWidth: "100%" }}>
          <Cubo size={13} color={c.muted} /><Text style={[s.muted, { fontSize: 12 }]} numberOfLines={1}>{st.model}</Text>
        </View>
      )}
      <Text style={[s.muted, { fontSize: 12 }]}>{st.estimated ? "~" : ""}{(st.tokens ?? 0).toLocaleString("pt-BR")} tokens</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Relogio size={13} color={c.muted} />
        <Text style={[s.muted, { fontSize: 12 }]}>{seg < 60 ? `${seg.toFixed(1)}s` : `${Math.floor(seg / 60)}m${Math.round(seg % 60)}s`}</Text>
      </View>
      {st.tps != null && <Text style={[s.muted, { fontSize: 12 }]}>{st.tps.toFixed(1)} t/s</Text>}
    </View>
  );
}

const STATUS: Record<string, [string, string]> = {
  erro: ["erro", c.red], rejeitada: ["rejeitada", "#fb923c"], cancelada: ["cancelada", c.faint], ok: ["", c.faint],
};

/** "Executou um comando, usou 3 ferramentas ›" — toque abre as peças; toque numa peça mostra o detalhe. */
function Grupo({ pecas, resultados, pendentes }: { pecas: Peca[]; resultados: Map<any, Msg>; pendentes: Set<string> }) {
  const [aberto, setAberto] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const calls = pecas.flatMap((p) => (p.tipo === "tool" ? [p.call] : []));
  const falhas = calls.filter((k) => ["erro", "rejeitada"].includes(resultados.get(k.id)?.status ?? "")).length;
  const alvo = calls[0]?.arguments?.query ?? calls[0]?.arguments?.url;
  const soNotas = pecas.every((p) => p.tipo === "nota");
  const cabeca = (calls.length ? (ACAO[calls[0].name] ?? `Usou ${calls[0].name}`) : soNotas ? "Avisos ao agente" : "Raciocinou") +
    (typeof alvo === "string" ? ` — ${alvo}` : "");
  const resumo = (calls.length > 1 ? `${cabeca}, usou ${calls.length} ferramentas` : cabeca) +
    (falhas ? ` (${falhas} falha${falhas > 1 ? "s" : ""})` : "");
  const alterna = (id: string) => setDetalhe(detalhe === id ? null : id);
  const abreSlots = useContext(AbreSlots);
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={() => setAberto(!aberto)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {!calls.length && !soNotas && <Cerebro size={14} color={c.faint} />}
        <Text style={[s.faint, { flexShrink: 1, fontSize: 14 }]} numberOfLines={1}>{resumo}</Text>
        {aberto ? <Abaixo size={14} color={c.faint} /> : <Seta size={14} color={c.faint} />}
      </Pressable>
      {/* Fora do recolhível, como no desktop (MessageView ActivityGroup): a fila de imagens do site. */}
      {calls.map((k) => {
        const r = resultados.get(k.id);
        const sl = r?.meta?.imagens_pendentes;
        if (!r || !sl?.slots?.length) return null;
        return (
          <View key={`sl${k.id}`} style={{ gap: 6 }}>
            <Pressable onPress={() => abreSlots(r.id)} style={[s.btn, { alignSelf: "flex-start", flexDirection: "row", gap: 8, alignItems: "center" }]}>
              <Imagem size={16} color={c.bg} />
              <Text style={s.btnTxt}>{sl.geradas ? `Ver as ${sl.slots.length} imagens` : `Gerar ${sl.slots.length} imagens`}</Text>
            </Pressable>
            <Text style={[s.faint, { fontSize: 12 }]} numberOfLines={2}>{sl.slots.map((x: any) => x.nome).join(" · ")}</Text>
          </View>
        );
      })}
      {aberto && (
        <View style={{ marginTop: 8, marginLeft: 4, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: c.line, gap: 10 }}>
          {pecas.map((p) => {
            if (p.tipo !== "tool")
              return (
                <View key={p.id} style={{ gap: 6 }}>
                  <Pressable onPress={() => alterna(p.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {p.tipo === "pensou" && <Cerebro size={13} color={c.faint} />}
                    <Text style={[s.faint, { fontSize: 12.5 }]}>{p.tipo === "pensou" ? "Raciocínio" : p.titulo}</Text>
                  </Pressable>
                  {detalhe === p.id && <Text style={[s.muted, { fontSize: 12.5, lineHeight: 19 }]} selectable>{p.texto}</Text>}
                </View>
              );
            const k = p.call;
            const r = resultados.get(k.id);
            const [rot, cor] = pendentes.has(k.id) ? ["aguardando aprovação", c.amber] : STATUS[r?.status ?? ""] ?? ["", c.faint];
            const arg = k.arguments?.command ?? k.arguments?.path ?? k.arguments?.query ?? k.arguments?.url ?? "";
            return (
              <View key={p.id} style={{ gap: 6 }}>
                <Pressable onPress={() => alterna(p.id)} style={{ gap: 2 }}>
                  <Text numberOfLines={1} style={{ fontFamily: mono, fontSize: 12.5, color: c.fg }}>
                    {k.name} <Text style={{ color: c.faint }}>{texto(arg)}</Text>
                  </Text>
                  {!!rot && <Text style={{ fontSize: 12, color: cor }}>● {rot}</Text>}
                </Pressable>
                {detalhe === p.id && <Codigo texto={texto(r?.content) || "Sem resultado ainda."} max={260} />}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Preview do backend: {kind: command|diff|new, path, text} (shell.py / tools.py). */
function Preview({ a }: { a: Aprovacao }) {
  const p = a.preview && typeof a.preview === "object" ? (a.preview as { kind?: string; path?: string; text?: string }) : null;
  if (!p) return <Codigo texto={texto(a.call.arguments)} max={240} />;
  const rotulo = p.kind === "command" ? "Comando" : p.kind === "new" ? "Novo arquivo" : "Alteração";
  return (
    <View style={{ borderColor: c.line, borderWidth: 1, borderRadius: 12, overflow: "hidden" }}>
      <Text numberOfLines={1} style={{ backgroundColor: c.surface, color: c.muted, fontSize: 12, paddingHorizontal: 12, paddingVertical: 7 }}>
        {rotulo} · <Text style={{ fontFamily: mono }}>{p.path}</Text>
      </Text>
      <View style={{ backgroundColor: c.code, padding: 12, maxHeight: 260 }}>
        {p.kind === "diff" ? (
          (p.text ?? "").split("\n").slice(0, 60).map((l, i) => (
            <Text key={i} style={{ fontFamily: mono, fontSize: 12, lineHeight: 18,
              color: l.startsWith("+") ? c.green : l.startsWith("-") ? c.red : l.startsWith("@@") ? c.sky : c.muted }}>{l}</Text>
          ))
        ) : (
          <Text style={{ fontFamily: mono, fontSize: 12.5, lineHeight: 19, color: c.fg }} numberOfLines={14} selectable>
            {p.kind === "command" ? "$ " : ""}{p.text}
          </Text>
        )}
      </View>
    </View>
  );
}

function CardAprovacao({ a, onDecide }: { a: Aprovacao; onDecide: (a: Aprovacao, body: Record<string, unknown>, regra?: boolean) => void }) {
  const [nota, setNota] = useState("");
  const [comNota, setComNota] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const vai = (body: Record<string, unknown>, regra?: boolean) => { setEnviado(true); onDecide(a, body, regra); };
  const nome = a.call.name;
  const plano = nome === "exit_plan_mode";
  const pergunta = nome === "ask_user";
  const resumo = texto(a.call.arguments?.command ?? a.call.arguments?.path ?? "");

  return (
    <View style={{ borderColor: c.amberLine, borderWidth: 1, borderRadius: 18, backgroundColor: c.bg, overflow: "hidden", opacity: enviado ? 0.5 : 1 }}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomColor: c.line, borderBottomWidth: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontFamily: mono, fontSize: 13.5, color: c.fg }}>
          <Text style={{ fontWeight: "700" }}>{plano ? "Plano" : pergunta ? "Pergunta" : nome}</Text>
          {!plano && !pergunta && <Text style={{ color: c.faint }}> {resumo}</Text>}
        </Text>
        <Text style={{ color: c.amber, fontSize: 12 }}>● {pergunta ? "aguardando resposta" : "aguardando aprovação"}</Text>
      </View>
      <View style={{ padding: 14, gap: 12 }}>
        {pergunta ? (
          <Perguntas a={a} enviado={enviado} onResponde={(answers) => vai({ approved: true, answers })} />
        ) : (
          <>
            {plano ? <Markdown texto={texto(a.plan ?? a.call.arguments?.plan)} /> : <Preview a={a} />}
            {!!a.nota && <Text style={{ color: "#fde68a", fontSize: 12 }}>{a.nota}</Text>}
            {comNota && (
              <TextInput style={s.input} value={nota} onChangeText={setNota} autoFocus multiline
                         placeholder={plano ? "O que mudar no plano" : "Por que rejeitar (vai para a IA)"} placeholderTextColor={c.faint} />
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Pressable disabled={enviado} style={s.btn} onPress={() => vai({ approved: true })}>
                <Text style={s.btnTxt}>{plano ? "Aprovar plano" : "Aprovar"}</Text>
              </Pressable>
              {!!a.suggest && !plano && (
                <Pressable disabled={enviado} style={[s.btnSec, { flexDirection: "row", gap: 6 }]} onPress={() => vai({ approved: true }, true)}>
                  <Escudo size={15} /><Text style={s.btnSecTxt}>Sempre</Text>
                  <Text style={{ fontFamily: mono, fontSize: 12, color: c.muted }}>{a.suggest}</Text>
                </Pressable>
              )}
              <Pressable disabled={enviado} style={s.btnSec}
                         onPress={() => (comNota ? vai({ approved: false, feedback: nota.trim() || undefined }) : setComNota(true))}>
                <Text style={s.btnSecTxt}>{comNota ? "Enviar" : plano ? "Pedir mudanças" : "Rejeitar"}</Text>
              </Pressable>
              {comNota && !plano && (
                <Pressable disabled={enviado} style={{ justifyContent: "center", paddingHorizontal: 6 }} onPress={() => vai({ approved: false })}>
                  <Text style={s.faint}>Rejeitar sem motivo</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

type Q = { header?: string; question: string; options: { label: string; description?: string }[]; multi_select?: boolean };

/** ask_user: até 4 perguntas; toque escolhe opção, ou escreve outra resposta. */
function Perguntas({ a, enviado, onResponde }: { a: Aprovacao; enviado: boolean; onResponde: (answers: string[]) => void }) {
  const args = a.call.arguments ?? {};
  const qs: Q[] = (a.questions as Q[] | undefined) ??
    (Array.isArray(args.questions) ? args.questions : [{ question: args.question, options: args.options ?? [] }])
      .filter((q: any) => q?.question)
      .map((q: any) => ({ ...q, options: (q.options ?? []).map((o: any) => (typeof o === "string" ? { label: o } : o)) }));
  const [resp, setResp] = useState<string[][]>(() => qs.map(() => []));
  const [livre, setLivre] = useState<string[]>(() => qs.map(() => ""));
  const escolhe = (i: number, label: string, multi?: boolean) =>
    setResp((r) => r.map((x, j) => (j !== i ? x : multi ? (x.includes(label) ? x.filter((y) => y !== label) : [...x, label]) : [label])));
  const respostas = qs.map((_, i) => [...resp[i], livre[i].trim()].filter(Boolean).join(", "));
  return (
    <View style={{ gap: 16 }}>
      {qs.map((q, i) => (
        <View key={i} style={{ gap: 8 }}>
          {!!q.header && <Text style={s.secao}>{q.header}</Text>}
          <Markdown texto={q.question} />
          {q.options.map((o) => {
            const on = resp[i].includes(o.label);
            return (
              <Pressable key={o.label} onPress={() => escolhe(i, o.label, q.multi_select)}
                         style={{ borderColor: on ? c.fg : c.line, borderWidth: 1, borderRadius: 12, padding: 11,
                                  backgroundColor: on ? c.raised : "transparent" }}>
                <Text style={s.txt}>{o.label}</Text>
                {!!o.description && <Text style={s.muted}>{o.description}</Text>}
              </Pressable>
            );
          })}
          <TextInput style={s.input} value={livre[i]} onChangeText={(t) => setLivre((l) => l.map((x, j) => (j === i ? t : x)))}
                     placeholder="Outra resposta" placeholderTextColor={c.faint} />
        </View>
      ))}
      <Pressable disabled={enviado || respostas.some((r) => !r)} style={[s.btn, respostas.some((r) => !r) && { opacity: 0.4 }]}
                 onPress={() => onResponde(respostas)}>
        <Text style={s.btnTxt}>Responder</Text>
      </Pressable>
    </View>
  );
}

/** Mensagens só para leitura, com o mesmo desenho do chat (a transcrição de um Worker do Maestro). */
export function Transcricao({ msgs }: { msgs: Msg[] }) {
  const segs = useMemo(() => segmentos(msgs), [msgs]);
  const resultados = useMemo(() => new Map(msgs.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m])), [msgs]);
  const vazio = useMemo(() => new Set<string>(), []);
  return (
    <View style={{ gap: 14 }}>
      {segs.map((sg) => <Segmento key={"m" in sg ? `${sg.tipo}${sg.m.id}` : sg.id} seg={sg} resultados={resultados} pendentes={vazio} />)}
    </View>
  );
}
