import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { api, imagemComToken, type Msg } from "./api";
import { WebView } from "react-native-webview";
import Site from "./Site";
import { Codigo } from "./Markdown";
import { useTeclado } from "./teclado";
import { pergunta } from "./Dialogo";
import { c, mono, s } from "./tema";

// Os 7 painéis do canto superior direito do desktop (RightPanel.tsx, TABS), na mesma ordem.
export type PainelId = "info" | "navegador" | "terminal" | "alteracoes" | "instancias" | "local" | "planos";
export const PAINEIS: { id: PainelId; rotulo: string; dica: string }[] = [
  { id: "info", rotulo: "Info", dica: "Modelo, ferramentas e uso da conversa" },
  { id: "navegador", rotulo: "Navegador", dica: "O navegador da IA nesta conversa" },
  { id: "terminal", rotulo: "Terminal", dica: "Shell na pasta da conversa" },
  { id: "alteracoes", rotulo: "Alterações", dica: "Arquivos mudados e git" },
  { id: "instancias", rotulo: "Instâncias", dica: "Subagentes e processos em segundo plano" },
  { id: "local", rotulo: "IA local", dica: "Modelo carregado na GPU" },
  { id: "planos", rotulo: "Planos", dica: "Planos propostos nesta conversa" },
];

type P = { conv: number | null; onAbreConv: (id: number) => void };

export function Painel({ id, ...p }: P & { id: PainelId }) {
  const semConv = <Text style={[s.muted, { padding: 16 }]}>Abra uma conversa para ver este painel.</Text>;
  if (id === "info") return <Info {...p} />;
  if (id === "navegador") return p.conv == null ? semConv : <Navegador {...p} conv={p.conv} />;
  if (id === "terminal") return p.conv == null ? semConv : <Terminal {...p} conv={p.conv} />;
  if (id === "alteracoes") return p.conv == null ? semConv : <Alteracoes {...p} conv={p.conv} />;
  if (id === "instancias") return <Instancias {...p} />;
  if (id === "local") return <Local />;
  return p.conv == null ? semConv : <Planos conv={p.conv} />;
}

function usePoll(fn: () => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    fn();
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, deps);
}

const Linha = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 }}>
    <Text style={s.muted}>{k}</Text><Text style={[s.txt, { fontSize: 14, flexShrink: 1, textAlign: "right" }]}>{v}</Text>
  </View>
);
const Chips = ({ opcoes, valor, onMuda }: { opcoes: string[]; valor: string; onMuda: (v: string) => void }) => (
  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
    {opcoes.map((o) => (
      <Pressable key={o} onPress={() => onMuda(o)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: valor === o ? c.fg : c.raised }}>
        <Text style={{ color: valor === o ? "#000" : c.muted, fontSize: 12.5 }}>{o}</Text>
      </Pressable>
    ))}
  </View>
);

// ------------------------------------------------------------------ Info

function Info({ conv }: P) {
  const [d, setD] = useState<Record<string, string>>({});
  const [ms, setMs] = useState<{ tool_mode: string; vision: string } | null>(null);
  const [tools, setTools] = useState<{ enabled: boolean; source: string }[]>([]);
  const [mcp, setMcp] = useState<{ servers: { name?: string; status?: string; tools?: unknown[] }[]; config_error?: string } | null>(null);
  const [uso, setUso] = useState({ tokens: 0, segundos: 0, turnos: 0 });
  useEffect(() => {
    api.get<{ defaults: Record<string, string> }>("/mobile").then(({ defaults }) => {
      setD(defaults);
      if (defaults.model) api.get<any>(`/model-settings?model=${encodeURIComponent(defaults.model)}`).then(setMs).catch(() => {});
    }).catch(() => {});
    api.get<any[]>("/tools").then(setTools).catch(() => {});
    api.get<any>("/mcp").then(setMcp).catch(() => {});
    if (conv != null) api.get<{ messages: Msg[] }>(`/conversations/${conv}`).then(({ messages }) => {
      const st = messages.map((m) => m.meta?.stats).filter(Boolean);
      setUso({ tokens: st.reduce((a, x) => a + (x.tokens ?? 0), 0), segundos: st.reduce((a, x) => a + (x.seconds ?? 0), 0), turnos: st.length });
    }).catch(() => {});
  }, [conv]);
  const salva = (campo: "tool_mode" | "vision", v: string) =>
    api.put("/model-settings", { model: d.model, [campo]: v }).then(() => setMs((x) => x && { ...x, [campo]: v })).catch(() => {});
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View><Text style={s.secao}>Modelo</Text>
        <Linha k="Provedor" v={d.provider ?? "—"} /><Linha k="Modelo" v={d.model ?? "—"} /><Linha k="Esforço" v={d.effort ?? "—"} />
      </View>
      {ms && (
        <View style={{ gap: 8 }}>
          <Text style={s.muted}>Chamada de ferramentas</Text>
          <Chips opcoes={["auto", "native", "text"]} valor={ms.tool_mode} onMuda={(v) => salva("tool_mode", v)} />
          <Text style={s.muted}>Visão (imagens)</Text>
          <Chips opcoes={["auto", "yes", "no"]} valor={ms.vision} onMuda={(v) => salva("vision", v)} />
        </View>
      )}
      <View><Text style={s.secao}>Ferramentas</Text>
        <Linha k="Ativas" v={`${tools.filter((t) => t.enabled).length} de ${tools.length}`} />
        <Linha k="MCP" v={mcp?.config_error ? mcp.config_error : `${mcp?.servers.length ?? 0} servidor(es)`} />
        {mcp?.servers.map((sv, i) => <Linha key={i} k={`  ${sv.name ?? "servidor"}`} v={`${sv.status ?? ""} ${sv.tools?.length ?? 0} ferramentas`} />)}
      </View>
      {conv != null && (
        <View><Text style={s.secao}>Uso nesta conversa</Text>
          <Linha k="Respostas" v={uso.turnos} /><Linha k="Tokens gerados" v={uso.tokens.toLocaleString("pt-BR")} />
          <Linha k="Tempo gerando" v={`${Math.round(uso.segundos)}s`} />
        </View>
      )}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Navegador

type Estado = { open: boolean; url: string; title: string; width: number; height: number; native: boolean;
                tabs: { index: number; url: string; title: string; active: boolean }[] };

/** O navegador que a IA usa nesta conversa: foto ao vivo da aba (toque = clique), endereço e abas.
 * Aba escondida no desktop não desenha (sem foto possível): aí o botão abre a mesma página aqui no celular. */
function Navegador({ conv }: P & { conv: number }) {
  const [st, setSt] = useState<Estado | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [escondida, setEscondida] = useState(false);
  const [aqui, setAqui] = useState(false);
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState("");
  const { width } = useWindowDimensions();
  const q = `conv=${conv}`;
  const ultimaFoto = useRef(0);
  usePoll(() => {
    api.get<Estado>(`/browser?${q}`).then((e) => {
      setSt(e);
      // Escondida: a captura espera 5 s e falha; tenta de novo só a cada 8 s.
      if (!e.open || (escondida && Date.now() - ultimaFoto.current < 8000)) return;
      ultimaFoto.current = Date.now();
      imagemComToken(`/browser/shot?${q}`).then((f) => { setFoto(f); setEscondida(false); })
        .catch((er) => (er.status === 503 ? setEscondida(true) : setErro(er.message)));
    }).catch((e) => setErro(e.message));
  }, 1500, [conv, escondida]);
  const age = (path: string, body: unknown) => api.post<Estado>(`${path}?${q}`, body).then((e) => e?.tabs && setSt(e)).catch((e) => setErro(e.message));
  if (!st) return <ActivityIndicator style={{ marginTop: 30 }} color={c.muted} />;
  if (aqui) return <AbreAqui url={st.url} onVolta={() => setAqui(false)} />;
  const larg = width - 28;
  const alt = st.width ? (larg * st.height) / st.width : larg;
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {(["back", "forward", "reload"] as const).map((a) => (
          <Pressable key={a} onPress={() => age("/browser/navigate", { url: "", action: a })} style={botaoPeq}>
            <Text style={s.muted}>{a === "back" ? "‹" : a === "forward" ? "›" : "⟳"}</Text>
          </Pressable>
        ))}
        <TextInput style={[s.input, { flex: 1, paddingVertical: 6, fontSize: 13 }]} value={url || st.url} onChangeText={setUrl}
                   onSubmitEditing={() => { age("/browser/navigate", { url, action: "" }); setUrl(""); }}
                   autoCapitalize="none" autoCorrect={false} placeholder="Endereço" placeholderTextColor={c.faint} />
      </View>
      {st.tabs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {st.tabs.map((tb) => (
            <Pressable key={tb.index} onPress={() => age("/browser/tabs", { action: "switch", index: tb.index })}
                       style={[botaoPeq, { maxWidth: 180, backgroundColor: tb.active ? c.raised : c.surface }]}>
              <Text style={{ color: tb.active ? c.fg : c.muted, fontSize: 12.5 }} numberOfLines={1}>{tb.title || tb.url}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {!st.open ? <Text style={s.muted}>A IA não abriu nenhuma página nesta conversa.</Text> : (
        <>
          {foto && !escondida ? (
            <Pressable onPress={(e) => {
              // Toque vira clique na coordenada da página (a foto está na escala da tela do celular).
              const k = st.width / larg;
              api.post(`/browser/input?${q}`, { type: "click", x: e.nativeEvent.locationX * k, y: e.nativeEvent.locationY * k, button: "left" })
                .catch((er) => setErro(er.message));
            }}>
              <Image source={{ uri: foto }} style={{ width: larg, height: alt, borderRadius: 10, backgroundColor: c.surface }} resizeMode="contain" />
            </Pressable>
          ) : (
            <View style={[cartao, { gap: 8 }]}>
              <Text style={s.txt}>{escondida ? "Sem imagem ao vivo" : "Carregando a imagem…"}</Text>
              {escondida && (
                <Text style={[s.muted, { lineHeight: 19 }]}>
                  No desktop esta aba está escondida (o painel Navegador da conversa não está aberto), e aba escondida não desenha.
                  Dá para abrir a mesma página aqui.
                </Text>
              )}
            </View>
          )}
          <Pressable style={[s.btnSec, { alignSelf: "flex-start" }]} onPress={() => setAqui(true)}>
            <Text style={s.btnSecTxt}>Abrir no celular</Text>
          </Pressable>
        </>
      )}
      <Text style={s.faint} numberOfLines={1}>{st.title}</Text>
      {!!erro && <Text style={{ color: c.red, fontSize: 12.5 }}>{erro}</Text>}
    </ScrollView>
  );
}

/** A página da aba da IA na WebView do celular. localhost é o PC: só abre se for um site que o agente subiu
 * (a porta passa pela tailnet via /mobile/expose); endereço público abre direto. */
function AbreAqui({ url, onVolta }: { url: string; onVolta: () => void }) {
  const [site, setSite] = useState<{ nome: string; caminho: string } | null>(null);
  const [erro, setErro] = useState("");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:(\d+))?(.*)$/.exec(url);
  useEffect(() => {
    if (!local) return;
    api.get<{ servers: { name: string; alive: boolean; url: string }[] }>("/servers").then(({ servers }) => {
      const sv = servers.find((x) => x.alive && x.url.includes(`:${local[3]}`));
      if (sv) setSite({ nome: sv.name, caminho: local[4] || "" });
      else setErro(`${url} é um endereço do PC, e só dá para abrir aqui os sites que o agente subiu.`);
    }).catch((e) => setErro(e.message));
  }, [url]);
  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={onVolta} style={{ padding: 12 }}><Text style={s.muted}>‹ Voltar ao painel</Text></Pressable>
      {erro ? <Text style={[s.muted, { color: c.red, padding: 14 }]}>{erro}</Text>
        : local ? (site ? <Site nome={site.nome} caminho={site.caminho} /> : <ActivityIndicator color={c.muted} />)
        : <WebView source={{ uri: url }} style={{ flex: 1, backgroundColor: "#fff" }} />}
    </View>
  );
}
const botaoPeq = { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: c.surface, borderColor: c.line, borderWidth: 1 };

// ------------------------------------------------------------------ Terminal

/** Mesmo shell do painel do desktop (sem PTY): long-poll da saída e uma linha de comando. */
export function Terminal({ conv, comando }: { conv: number; comando?: string }) {
  const [id, setId] = useState<string | null>(null);
  const [saida, setSaida] = useState("");
  const [cmd, setCmd] = useState("");
  const [erro, setErro] = useState("");
  const rolagem = useRef<ScrollView>(null);
  const teclado = useTeclado();
  useEffect(() => {
    let vivo = true;
    let cursor = 0;
    api.post<{ id: string; cwd: string; shell: string }>("/term/start", { conv }).then(async (t) => {
      setId(t.id);
      setSaida(`${t.shell} em ${t.cwd}\n`);
      // Comando pronto (o "Testar" do Comparar): entra assim que o shell abre.
      // Sem PTY o shell não ecoa o que entra: o comando aparece antes da saída (script que não imprime nada fica claro).
      if (comando) { setSaida((x) => `${x}$ ${comando}\n`); api.post(`/term/${t.id}/input`, { text: comando + "\n" }).catch(() => {}); }
      while (vivo) {
        try {
          const r = await api.get<{ text: string; cursor: number; alive: boolean }>(`/term/${t.id}/poll?cursor=${cursor}`, 30000);
          cursor = r.cursor;
          if (r.text) setSaida((x) => (x + r.text).slice(-60000));
          if (!r.alive) { setSaida((x) => x + "\n[shell encerrado]\n"); break; }
        } catch { await new Promise((ok) => setTimeout(ok, 2000)); }
      }
    }).catch((e) => setErro(e.message));
    return () => { vivo = false; };
  }, [conv]);
  const envia = () => {
    if (!id) return;
    setSaida((x) => `${x}$ ${cmd}\n`);
    api.post(`/term/${id}/input`, { text: cmd + "\n" }).catch((e) => setErro(e.message));
    setCmd("");
  };
  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      <ScrollView ref={rolagem} style={{ flex: 1, backgroundColor: c.code }} contentContainerStyle={{ padding: 12 }}
                  onContentSizeChange={() => rolagem.current?.scrollToEnd({ animated: false })}>
        <Text style={{ fontFamily: mono, fontSize: 12, color: c.fg }} selectable>{saida}</Text>
      </ScrollView>
      {!!erro && <Text style={{ color: c.red, padding: 8 }}>{erro}</Text>}
      <View style={{ flexDirection: "row", gap: 8, padding: 10, borderTopColor: c.line, borderTopWidth: 1 }}>
        <TextInput style={[s.input, { flex: 1, fontFamily: mono, fontSize: 13 }]} value={cmd} onChangeText={setCmd} onSubmitEditing={envia}
                   autoCapitalize="none" autoCorrect={false} placeholder="comando" placeholderTextColor={c.faint} returnKeyType="send" />
        <Pressable style={s.btn} onPress={envia}><Text style={s.btnTxt}>↵</Text></Pressable>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Alterações

type Arquivo = { path: string; status: string; diff: string; binary: boolean; additions: number; deletions: number };

function Alteracoes({ conv }: P & { conv: number }) {
  const [arqs, setArqs] = useState<Arquivo[] | null>(null);
  const [git, setGit] = useState<{ repo: boolean; branch?: string; ahead?: number; files?: unknown[]; last_commit?: string } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const carrega = () => {
    api.get<{ files: Arquivo[] }>(`/conversations/${conv}/changes`).then((r) => setArqs(r.files.filter((f) => f.status !== "unchanged")))
      .catch((e) => setErro(e.message));
    api.get<any>(`/conversations/${conv}/git`).then(setGit).catch(() => {});
  };
  useEffect(carrega, [conv]);

  async function commit() {
    setErro("");
    try {
      if (msg == null) {
        // Como o desktop: primeiro o modelo propõe a mensagem (dry), depois o usuário confirma.
        const { defaults } = await api.get<{ defaults: Record<string, string> }>("/mobile");
        setMsg((await api.post<{ message: string }>(`/conversations/${conv}/git/commit`, { provider: defaults.provider, model: defaults.model, dry: true }, 180000)).message); // o modelo escreve a mensagem
      } else {
        const r = await api.post<{ sha: string }>(`/conversations/${conv}/git/commit`, { message: msg });
        setMsg(null);
        pergunta("Commit feito", r.sha, [{ texto: "Ok" }]);
        carrega();
      }
    } catch (e: any) { setErro(e.message); }
  }
  const cor = (st: string) => (st === "created" ? c.green : st === "deleted" ? c.red : c.amber);
  // O backend manda caminho absoluto; na tela, só a parte depois da pasta em comum (o nome some nas reticências).
  const pastas = (arqs ?? []).map((f) => f.path.split("/").slice(0, -1));
  const comum = pastas.length ? pastas.reduce((a, b) => a.slice(0, a.findIndex((x, i) => x !== b[i]) < 0 ? a.length : a.findIndex((x, i) => x !== b[i]))) : [];
  const rel = (p: string) => p.split("/").slice(comum.length).join("/");
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
      {git?.repo && (
        <View style={{ gap: 6 }}>
          <Text style={s.muted}>git · {git.branch}{git.ahead ? ` · ${git.ahead} à frente` : ""} · {git.files?.length ?? 0} mudança(s)</Text>
          {!!git.files?.length && (
            <>
              {msg != null && <TextInput style={s.input} value={msg} onChangeText={setMsg} multiline />}
              <Pressable style={[s.btnSec, { alignSelf: "flex-start" }]} onPress={commit}>
                <Text style={s.btnSecTxt}>{msg == null ? "Propor mensagem de commit" : "Confirmar commit"}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
      {arqs == null ? <ActivityIndicator color={c.muted} /> : !arqs.length ? <Text style={s.muted}>A IA não mudou arquivos nesta conversa.</Text> : null}
      {arqs?.map((f) => (
        <View key={f.path} style={{ gap: 6 }}>
          <Pressable onPress={() => setAberto(aberto === f.path ? null : f.path)} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ color: cor(f.status), fontFamily: mono, fontSize: 12 }}>{f.status[0].toUpperCase()}</Text>
            <Text style={[s.txt, { flex: 1, fontSize: 13.5, fontFamily: mono }]} numberOfLines={1} ellipsizeMode="head">{rel(f.path)}</Text>
            <Text style={{ color: c.green, fontSize: 12 }}>+{f.additions}</Text><Text style={{ color: c.red, fontSize: 12 }}>−{f.deletions}</Text>
          </Pressable>
          {aberto === f.path && (f.binary ? <Text style={s.faint}>Arquivo binário.</Text> : (
            <View style={{ backgroundColor: c.code, borderRadius: 10, padding: 10 }}>
              {f.diff.split("\n").slice(0, 300).map((l, i) => (
                <Text key={i} style={{ fontFamily: mono, fontSize: 11.5, color: l.startsWith("+") ? c.green : l.startsWith("-") ? c.red : l.startsWith("@@") ? c.sky : c.muted }}>{l}</Text>
              ))}
            </View>
          ))}
        </View>
      ))}
      {!!erro && <Text style={{ color: c.red }}>{erro}</Text>}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Instâncias

type Proc = { name: string; alive: boolean; command: string; conv?: string; url?: string; uptime?: number; exit_code?: number | null };
type Sub = { id: string; conversation_id: number; conversation: string; run_id: string; task: string; status: string; seconds: number;
             model: string; level: string; steps: number };

function Instancias({ onAbreConv }: P) {
  const [procs, setProcs] = useState<Proc[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [log, setLog] = useState<{ nome: string; texto: string } | null>(null);
  const carrega = () => {
    api.get<{ servers: Proc[] }>("/servers").then((r) => setProcs(r.servers)).catch(() => {});
    api.get<{ subagents: Sub[] }>("/subagents/active").then((r) => setSubs(r.subagents)).catch(() => {});
  };
  usePoll(carrega, 4000, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Text style={s.secao}>Subagentes</Text>
      {!subs.length && <Text style={s.faint}>Nenhum subagente rodando.</Text>}
      {subs.map((sb) => (
        <View key={sb.id} style={cartao}>
          <Text style={[s.txt, { fontSize: 14 }]} numberOfLines={2}>{sb.task}</Text>
          <Text style={s.faint}>{sb.level} · {sb.model} · {sb.steps} passos · {Math.round(sb.seconds)}s · {sb.status}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable style={botaoPeq} onPress={() => onAbreConv(sb.conversation_id)}><Text style={s.muted}>{sb.conversation}</Text></Pressable>
            <Pressable style={botaoPeq} onPress={() => api.post(`/runs/${sb.run_id}/stop`).then(carrega)}><Text style={{ color: c.red }}>Parar</Text></Pressable>
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={[s.secao, { flex: 1 }]}>Processos</Text>
        {procs.some((p) => !p.alive) && <Pressable onPress={() => api.post("/servers/clear").then(carrega)}><Text style={s.faint}>Limpar encerrados</Text></Pressable>}
      </View>
      {!procs.length && <Text style={s.faint}>Nenhum processo em segundo plano.</Text>}
      {procs.map((p) => (
        <View key={p.name} style={cartao}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.alive ? c.green : c.faint }} />
            <Text style={[s.txt, { flex: 1, fontSize: 14 }]}>{p.name}</Text>
            <Text style={s.faint}>{p.alive ? `${Math.round((p.uptime ?? 0) / 60)} min` : `saiu (${p.exit_code})`}</Text>
          </View>
          <Text style={[s.faint, { fontFamily: mono, fontSize: 11.5 }]} numberOfLines={2}>$ {p.command}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable style={botaoPeq} onPress={() => api.get<{ log: string }>(`/servers/${p.name}/log?tail=120`).then((r) => setLog({ nome: p.name, texto: r.log }))}>
              <Text style={s.muted}>Log</Text>
            </Pressable>
            {p.alive && <Pressable style={botaoPeq} onPress={() => api.post(`/servers/${p.name}/stop`).then(carrega)}><Text style={{ color: c.red }}>Parar</Text></Pressable>}
          </View>
          {log?.nome === p.name && <Codigo texto={log.texto || "(vazio)"} max={260} />}
        </View>
      ))}
    </ScrollView>
  );
}
const cartao = { borderColor: c.line, borderWidth: 1, borderRadius: 14, padding: 12, gap: 6, backgroundColor: c.surface };

// ------------------------------------------------------------------ IA local

function Local() {
  const [st, setSt] = useState<any>(null);
  const [erro, setErro] = useState("");
  usePoll(() => { api.get<any>("/local").then((x) => { setSt(x); setErro(""); }).catch((e) => setErro(e.message)); }, 3000, []);
  if (!st) return <ActivityIndicator style={{ marginTop: 30 }} color={c.muted} />;
  const sv = st.server ?? {};
  const carrega = (m: { path: string; name: string }) =>
    pergunta("Carregar modelo", `Carregar ${m.name} na GPU? O modelo atual é descarregado.`, [
      { texto: "Cancelar", estilo: "cancelar" },
      // O /local/load só responde com o modelo pronto (dezenas de segundos): limite longo.
      { texto: "Carregar", acao: () => api.post("/local/load", { path: m.path, params: {} }, 300000).catch((e) => setErro(e.message)) },
    ]);
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={cartao}>
        <Text style={s.secao}>Servidor</Text>
        {sv.loading?.name ? (
          <>
            <Text style={s.txt}>Carregando {sv.loading.name}{sv.loading.percent != null ? ` · ${Math.round(sv.loading.percent)}%` : ""}</Text>
            <Pressable style={botaoPeq} onPress={() => api.post("/local/cancel-load")}><Text style={s.muted}>Cancelar</Text></Pressable>
          </>
        ) : sv.running ? (
          <>
            <Text style={s.txt}>{sv.alias || sv.path}</Text>
            <Text style={s.faint}>contexto {sv.ctx ?? "?"} · porta {sv.port}{sv.uptime ? ` · ${Math.round(sv.uptime / 60)} min` : ""}{sv.vision ? " · visão" : ""}</Text>
            <Pressable style={[botaoPeq, { alignSelf: "flex-start" }]} onPress={() => pergunta("Descarregar", "Liberar a VRAM agora?", [
              { texto: "Cancelar", estilo: "cancelar" }, { texto: "Descarregar", acao: () => api.post("/local/unload").catch((e) => setErro(e.message)) }])}>
              <Text style={{ color: c.red }}>Descarregar</Text>
            </Pressable>
          </>
        ) : <Text style={s.muted}>Nenhum modelo carregado.</Text>}
        {!!sv.error?.message && <Text style={{ color: c.red, fontSize: 12.5 }}>{sv.error.message}</Text>}
        {st.image_busy && <Text style={{ color: c.amber, fontSize: 12.5 }}>Gerando imagem agora.</Text>}
      </View>
      {!!st.jobs?.length && (
        <View style={{ gap: 6 }}>
          <Text style={s.secao}>Downloads e instalações</Text>
          {st.jobs.map((j: any) => (
            <Text key={j.id} style={s.muted}>{j.name} · {j.status}{j.total ? ` · ${Math.round((j.done / j.total) * 100)}%` : ""}{j.error ? ` · ${j.error}` : ""}</Text>
          ))}
        </View>
      )}
      <Text style={s.secao}>Modelos de texto</Text>
      {(st.models ?? []).filter((m: any) => m.kind === "chat").map((m: any) => {
        const ativo = sv.running && sv.path === m.path;
        return (
          <Pressable key={m.path} onPress={() => !ativo && carrega(m)} style={[cartao, ativo && { borderColor: c.green }]}>
            <Text style={[s.txt, { fontSize: 14 }]}>{m.name}</Text>
            <Text style={s.faint}>{(m.size / 1e9).toFixed(1)} GB{m.ctx ? ` · ctx ${m.ctx}` : ""}{m.vision ? " · visão" : ""}{ativo ? " · carregado" : ""}</Text>
          </Pressable>
        );
      })}
      {!!erro && <Text style={{ color: c.red }}>{erro}</Text>}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Planos

/** Planos (exit_plan_mode) da conversa, com o desfecho; aprovar é no card do chat, como no desktop. */
function Planos({ conv }: { conv: number }) {
  const [planos, setPlanos] = useState<{ id: string; plano: string; status: string }[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ messages: Msg[] }>(`/conversations/${conv}`).then(({ messages }) => {
      const res = new Map(messages.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m]));
      setPlanos(messages.flatMap((m) => (m.tool_calls ?? []).filter((k) => k.name === "exit_plan_mode").map((k) => {
        const r = res.get(k.id);
        return { id: k.id, plano: String(k.arguments?.plan ?? ""),
                 status: !r ? "pendente" : r.meta?.approved ? `aprovado${r.meta?.approved_mode ? ` · ${r.meta.approved_mode}` : ""}` : r.status === "cancelada" ? "cancelado" : "ajustes" };
      })).reverse());
    }).catch(() => setPlanos([]));
  }, [conv]);
  if (!planos) return <ActivityIndicator style={{ marginTop: 30 }} color={c.muted} />;
  if (!planos.length) return <Text style={[s.muted, { padding: 16 }]}>Nenhum plano nesta conversa. Use a permissão Plano para a IA propor um antes de mexer.</Text>;
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
      {planos.map((p) => (
        <Pressable key={p.id} onPress={() => setAberto(aberto === p.id ? null : p.id)} style={cartao}>
          <Text style={{ color: p.status.startsWith("aprovado") ? c.green : p.status === "pendente" ? c.amber : c.muted, fontSize: 12.5 }}>{p.status}</Text>
          <Text style={s.txt} numberOfLines={aberto === p.id ? undefined : 3}>{p.plano}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
