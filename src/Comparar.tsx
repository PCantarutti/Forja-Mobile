import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, cancelado, lerAjustes, type Msg, salvaAjustes, streamSSE } from "./api";
import type { Conv } from "./Chat";
import { pergunta as dialogo } from "./Dialogo";
import { Abaixo, Acima, Cubo, Enviar, Parar } from "./icones";
import Markdown from "./Markdown";
import Modelos, { chave, type Escolha } from "./Modelos";
import { Terminal } from "./Painel";
import Site from "./Site";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Campo, Chip, Folha, Opcao, Seletor } from "./ui";

// CompararItem / CompararEstado / julgamento do desktop (types.ts, comparar.py, baterias.py).
type Item = { id: string; rotulo: string; nome: string; status: string; content: string; reasoning?: string;
              stats?: { tokens?: number; seconds?: number; tps?: number }; error?: string };
type Estado = { message_id: number; status: string; modo: string; cego?: boolean; revelado?: boolean; voto?: string | null; itens: Item[] };
type Juizo = { status: string; juiz?: string; passos?: string[]; texto?: string; pensou?: string; erro?: string;
               stats?: { tokens?: number; seconds?: number; tps?: number } | null };
type Bateria = { titulo: string; mede: string; prompt: string; gabarito?: string; anexo?: { nome: string } | null };
type Ajustes = { modelos: Escolha[]; modo: "paralelo" | "sequencial"; cego: boolean; juiz: Escolha | null; autoJulgar: boolean };

const COR: Record<string, string> = { pronto: c.green, erro: c.red, rodando: c.sky, carregando: c.amber, cancelado: c.faint, pendente: c.faint };
const MODOS = [{ id: "paralelo" as const, rotulo: "Paralelo" }, { id: "sequencial" as const, rotulo: "Sequencial" }];

/** Primeiro bloco de código da resposta (o que o "Testar" roda), com a linguagem da cerca. */
function codigoDe(texto: string): { codigo: string; lang: string } | null {
  const m = /```([\w+-]*)\n([\s\S]*?)```/.exec(texto);
  return m ? { lang: m[1], codigo: m[2] } : null;
}

/** Comparar modelos: o mesmo prompt em 2 a 6 modelos, lado a lado, com bateria de teste, voto, teste do código e revisor. */
export default function Comparar({ conv, onCriada, onTurno }: { conv: Conv | null; onCriada: (c: Conv) => void; onTurno: () => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const estadoRef = useRef<Estado | null>(null);
  estadoRef.current = estado;
  const [pedido, setPedido] = useState("");
  const [aj, setAj] = useState<Ajustes>({ modelos: [], modo: "paralelo", cego: false, juiz: null, autoJulgar: false });
  const [prompt, setPrompt] = useState("");
  const [bateria, setBateria] = useState<{ id: string; b: Bateria } | null>(null);
  const [baterias, setBaterias] = useState<Record<string, Bateria>>({});
  const [juizo, setJuizo] = useState<Juizo | null>(null);
  const [folha, setFolha] = useState<null | "modelos" | "ajustes" | "juiz" | "adicionar" | "placar">(null);
  const [placar, setPlacar] = useState<{ nome: string; rodadas: number; vitorias: number; erros: number; tps: number | null }[]>([]);
  const [teste, setTeste] = useState<null | { tipo: "web"; servidor: string; caminho: string } | { tipo: "terminal"; comando: string }>(null);
  const [erro, setErro] = useState("");
  const [pagina, setPagina] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const abortJuiz = useRef<AbortController | null>(null);
  const paginas = useRef<FlatList<Item>>(null);
  // Uma rolagem por página (resposta ou Revisor): os botões ↑ ↓ agem na página que está na tela.
  const rolagens = useRef<Record<string, ScrollView | null>>({});
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const { width } = useWindowDimensions();
  const vaiPara = (i: number) => { setPagina(i); paginas.current?.scrollToIndex({ index: i, animated: true }); };
  const muda = (x: Partial<Ajustes>) => setAj((a) => {
    const n = { ...a, ...x };
    salvaAjustes("comparar", n);
    if (("autoJulgar" in x || "juiz" in x) && estadoRef.current)
      api.post(`/comparar/${estadoRef.current.message_id}/revisor`,
        { revisor: n.autoJulgar && n.juiz?.model ? { provider: n.juiz.provider, model: n.juiz.model } : null }).catch(() => {});
    return n;
  });

  const segue = useCallback((path: string, body?: unknown) => {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    return streamSSE(path, (ev) => (ev.erro ? setErro(ev.erro) : setEstado(ev)), ac.signal, body);
  }, []);
  const segueJuiz = useCallback((mid: number, body?: unknown) => {
    abortJuiz.current?.abort();
    const ac = (abortJuiz.current = new AbortController());
    return streamSSE(`/comparar/${mid}/julgar`, (ev) => setJuizo(ev.status === "nenhum" ? null : ev), ac.signal, body)
      .catch((e) => { if (!cancelado(e)) setErro(e.message); });
  }, []);

  useEffect(() => {
    lerAjustes<Ajustes>("comparar", aj).then(setAj);
    api.get<Record<string, Bateria>>("/comparar/baterias").then(setBaterias).catch(() => {});
    if (convId == null) return;
    // Conversa existente: o último lote (mensagem com meta.itens); o stream devolve o estado e reconecta se ainda roda.
    api.get<{ messages: Msg[] }>(`/conversations/${convId}`).then(({ messages }) => {
      const i = messages.map((m) => !!m.meta?.itens).lastIndexOf(true);
      if (i < 0) return;
      const m = messages[i];
      setPedido(messages[i - 1]?.content ?? "");
      setEstado({ message_id: m.id, status: m.status === "running" ? "rodando" : "pronto", modo: m.meta.modo, cego: m.meta.cego,
        revelado: m.meta.revelado, voto: m.meta.voto, itens: m.meta.itens });
      if (m.status === "running") segue(`/comparar/${m.id}/stream`).catch(() => {});
      segueJuiz(m.id); // GET: análise salva ou em andamento; {status:"nenhum"} se não houver
    }).catch((e) => setErro(e.message));
    return () => { abort.current?.abort(); abortJuiz.current?.abort(); };
  }, [convId]);

  const rodando = estado?.status === "rodando";
  const rodava = useRef(false);
  useEffect(() => {
    // Terminou: título pode ter mudado; e o "Analisar ao terminar" do desktop dispara o revisor.
    if (rodava.current && !rodando) {
      onTurno();
      // O servidor começa o revisor sozinho (ele vai no /rodar); aqui a tela só acompanha.
      if (estado?.status === "pronto" && aj.autoJulgar && aj.juiz) segueJuiz(estado.message_id);
    }
    rodava.current = rodando;
  }, [rodando]);

  async function roda(confirm = false, texto = prompt.trim(), jaCriada: number | null = null) {
    if (!texto || aj.modelos.length < 2) return;
    setErro("");
    let criada = jaCriada;
    try {
      // O repetir com confirm é outro closure (convId ainda null): recebe a conversa já criada, senão abria outra.
      let id = convId ?? jaCriada;
      if (id == null) {
        const nova = await api.post<Conv>("/conversations", { kind: "comparar" });
        id = nova.id;
        onCriada(nova);
        setConvId(id);
      }
      criada = id;
      setPedido(texto);
      setPrompt("");
      setPagina(0);
      setJuizo(null);
      const itens = aj.modelos.map((m) => (m.path ? { path: m.path, nome: m.nome } : { provider: m.provider, model: m.model, nome: m.nome }));
      // .gguf carrega um por vez na VRAM: o desktop trava o sequencial nesse caso.
      const modo = aj.modelos.some((m) => m.path) ? "sequencial" : aj.modo;
      await segue(`/comparar/${id}/rodar`, { prompt: texto, itens, modo, cego: aj.cego, confirm, bateria: bateria?.id ?? "",
        revisor: aj.autoJulgar && aj.juiz?.model ? { provider: aj.juiz.provider, model: aj.juiz.model } : null });
    } catch (e: any) {
      if (e.status === 409 && !confirm)
        return dialogo("VRAM ocupada", `${e.message}\n\nDescarregar e comparar?`,
          [{ texto: "Cancelar", estilo: "cancelar", acao: () => setPrompt(texto) }, { texto: "Descarregar e comparar", acao: () => roda(true, texto, criada) }]);
      if (!cancelado(e)) { setErro(e.message); setPrompt((p) => p || texto); } // falhou: o prompt volta para a caixa
    }
  }

  const acao = (sufixo: string, body?: unknown) =>
    estado && api.post(`/comparar/${estado.message_id}/${sufixo}`, body).then(() => segue(`/comparar/${estado.message_id}/stream`))
      .catch((e) => { if (!cancelado(e)) setErro(e.message); });

  async function vota(item: string) {
    if (!estado) return;
    try {
      const m = await api.post<Msg>(`/comparar/${estado.message_id}/voto`, { voto: item }); // de novo no mesmo desfaz
      setEstado((e) => e && { ...e, voto: m.meta?.voto ?? null, revelado: m.meta?.revelado });
    } catch (e: any) { setErro(e.message); }
  }

  function julgar() {
    if (!estado || !aj.juiz?.model) return setFolha("juiz");
    setJuizo({ status: "rodando" });
    segueJuiz(estado.message_id, { provider: aj.juiz.provider, model: aj.juiz.model });
  }

  async function testa(it: Item) {
    const cod = codigoDe(it.content);
    if (!cod || !estado) return;
    try {
      const r = await api.post<any>("/comparar/testar", { codigo: cod.codigo, linguagem: cod.lang, chave: `${estado.message_id}-${it.rotulo}`,
        conv: convId, bateria: bateria?.id ?? "" }, 60000);
      // Regex e não `new URL(...).pathname`: o URL do React Native não implementa pathname.
      if (r.tipo === "web") setTeste({ tipo: "web", servidor: r.servidor, caminho: String(r.url).replace(/^https?:\/\/[^/]+/, "") });
      else setTeste({ tipo: "terminal", comando: r.comando });
    } catch (e: any) { setErro(e.message); }
  }

  const nomeDe = (it: Item) => (estado?.cego && !estado.revelado ? `Modelo ${it.rotulo}` : `${it.rotulo} · ${it.nome}`);
  const pode = !!prompt.trim() && aj.modelos.length >= 2;

  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      {teste ? (
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => setTeste(null)} style={{ padding: 12 }}><Text style={s.muted}>‹ Voltar à comparação</Text></Pressable>
          {teste.tipo === "web" ? <Site nome={teste.servidor} caminho={teste.caminho} /> : convId != null && <Terminal conv={convId} comando={teste.comando} />}
        </View>
      ) : estado ? (
        <View style={{ flex: 1 }}>
          {!!pedido && <Text style={[s.muted, { paddingHorizontal: 16, paddingTop: 10 }]} numberOfLines={2}>“{pedido}”</Text>}
          {/* Abas: uma por resposta + o Revisor. Cada página rola sozinha (a lista horizontal não herda a altura da maior). */}
          <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 10 }}>
            {estado.itens.map((it, i) => (
              <Pressable key={it.id} onPress={() => vaiPara(i)}
                         style={{ flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 10,
                                  backgroundColor: pagina === i ? c.raised : c.surface, borderColor: estado.voto === it.id ? c.amber : c.line, borderWidth: 1 }}>
                <Text style={{ color: c.fg, fontWeight: "700" }}>{it.rotulo}{estado.voto === it.id ? " 🏆" : ""}</Text>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COR[it.status] ?? c.faint, marginTop: 3 }} />
              </Pressable>
            ))}
            <Pressable onPress={() => vaiPara(estado.itens.length)}
                       style={{ flex: 1.4, alignItems: "center", justifyContent: "center", paddingVertical: 6, borderRadius: 10,
                                backgroundColor: pagina === estado.itens.length ? c.raised : c.surface, borderColor: c.line, borderWidth: 1 }}>
              <Text style={{ color: c.fg, fontSize: 13 }}>Revisor</Text>
              {juizo?.status === "rodando" && <ActivityIndicator size="small" color={c.muted} />}
            </Pressable>
          </View>
          <FlatList
            style={{ flex: 1 }}
            data={[...estado.itens.map((it) => ({ tipo: "item" as const, it })), { tipo: "revisor" as const, it: null }]}
            horizontal
            pagingEnabled
            keyExtractor={(p) => (p.it ? p.it.id : "revisor")}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPagina(Math.round(e.nativeEvent.contentOffset.x / width))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            ref={paginas as any}
            renderItem={({ item: pg }) => pg.it ? (
              <ScrollView ref={(r) => { rolagens.current[pg.it!.id] = r; }} style={{ width }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 70 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Cubo size={15} color={c.muted} />
                  <Text style={[s.txt, { fontWeight: "600", flex: 1 }]} numberOfLines={1}>{nomeDe(pg.it)}</Text>
                  {["rodando", "carregando"].includes(pg.it.status) && <ActivityIndicator size="small" color={c.muted} />}
                </View>
                <Text style={{ color: COR[pg.it.status] ?? c.faint, fontSize: 12 }}>
                  {pg.it.status}{pg.it.stats?.tokens ? ` · ${pg.it.stats.tokens} tokens` : ""}
                  {pg.it.stats?.seconds ? ` · ${pg.it.stats.seconds.toFixed(1)}s` : ""}{pg.it.stats?.tps ? ` · ${pg.it.stats.tps.toFixed(1)} t/s` : ""}
                </Text>
                {!!pg.it.error && <Text style={[s.muted, { color: c.red }]}>{pg.it.error}</Text>}
                {pg.it.content ? <Markdown texto={pg.it.content} /> : pg.it.reasoning ? (
                  // Pensando: o raciocínio aparece apagado, como o bloco "Raciocinou" do chat.
                  <Text style={[s.faint, { fontSize: 13, lineHeight: 19 }]} numberOfLines={12}>{pg.it.reasoning.slice(-1200)}</Text>
                ) : !pg.it.error && <Text style={s.faint}>Aguardando…</Text>}
                {!rodando && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {pg.it.status === "pronto" && (
                      <Pressable style={estado.voto === pg.it.id ? s.btn : s.btnSec} onPress={() => vota(pg.it!.id)}>
                        <Text style={estado.voto === pg.it.id ? s.btnTxt : s.btnSecTxt}>{estado.voto === pg.it.id ? "🏆 Vencedor" : "Votar"}</Text>
                      </Pressable>
                    )}
                    {pg.it.status === "pronto" && codigoDe(pg.it.content) && (
                      <Pressable style={s.btnSec} onPress={() => testa(pg.it!)}><Text style={s.btnSecTxt}>▶ Testar</Text></Pressable>
                    )}
                    <Pressable style={s.btnSec} onPress={() => acao("refazer", { item: pg.it!.id })}><Text style={s.btnSecTxt}>Refazer</Text></Pressable>
                    {estado.itens.length > 2 && (
                      <Pressable style={s.btnSec} onPress={() => acao("remover", { item: pg.it!.id })}><Text style={[s.btnSecTxt, { color: c.red }]}>Remover</Text></Pressable>
                    )}
                    {estado.itens.length < 6 && (
                      <Pressable style={s.btnSec} onPress={() => setFolha("adicionar")}><Text style={s.btnSecTxt}>+ Modelo</Text></Pressable>
                    )}
                    <Pressable style={s.btnSec} onPress={() => setPrompt(pedido)}><Text style={s.btnSecTxt}>Reusar prompt</Text></Pressable>
                  </View>
                )}
              </ScrollView>
            ) : (
              // Revisor: um modelo lê as respostas (com o gabarito, se for bateria) e diz qual resolve melhor.
              <ScrollView ref={(r) => { rolagens.current.revisor = r; }} style={{ width }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 70 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[s.txt, { fontWeight: "600", flex: 1 }]}>Revisor</Text>
                  <Chip rotulo={aj.juiz?.nome ?? "Escolher modelo"} icone={<Cubo size={13} color={c.muted} />} onPress={() => setFolha("juiz")} max={200} />
                </View>
                <Text style={s.muted}>Um modelo lê todas as respostas{bateria ? " e o gabarito da bateria" : ""} e diz qual resolve melhor, e por quê.</Text>
                {juizo?.status === "rodando" ? (
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ActivityIndicator size="small" color={c.muted} />
                      <Text style={s.muted}>{juizo.passos?.[juizo.passos.length - 1] ?? "Analisando as respostas…"}</Text>
                    </View>
                    {!!juizo.texto && <Markdown texto={juizo.texto} />}
                    <Pressable style={[s.btnSec, { alignSelf: "flex-start" }]}
                               onPress={() => api.post(`/comparar/${estado.message_id}/julgar/parar`).catch((e) => setErro(e.message))}>
                      <Text style={s.btnSecTxt}>Parar</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    {!!juizo?.texto && <Markdown texto={juizo.texto} />}
                    {!!juizo?.stats?.tokens && (
                      <Text style={s.faint}>{juizo.juiz} · {juizo.stats.tokens} tokens · {Math.round(juizo.stats.seconds ?? 0)}s</Text>
                    )}
                    {!!juizo?.erro && <Text style={{ color: c.red, fontSize: 13 }}>{juizo.erro}</Text>}
                    {!rodando && (
                      <Pressable style={[s.btn, { alignSelf: "flex-start" }]} onPress={julgar}>
                        <Text style={s.btnTxt}>{juizo?.texto ? "Analisar de novo" : "Analisar com IA"}</Text>
                      </Pressable>
                    )}
                  </>
                )}
                <Opcao rotulo="Revisar ao terminar" dica="O PC começa o revisor sozinho quando todas as respostas ficarem prontas (vale também para Refazer e + Modelo)."
                       valor={aj.autoJulgar} onMuda={(v) => muda({ autoJulgar: v })} />
              </ScrollView>
            )}
          />
          <View style={{ position: "absolute", right: 14, bottom: 12, gap: 8 }}>
            {(["topo", "fim"] as const).map((onde) => (
              <Pressable key={onde} hitSlop={6}
                         onPress={() => {
                           const r = rolagens.current[estado.itens[pagina]?.id ?? "revisor"];
                           if (onde === "topo") r?.scrollTo({ y: 0, animated: true }); else r?.scrollToEnd({ animated: true });
                         }}
                         style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.raised, borderColor: c.line, borderWidth: 1,
                                  alignItems: "center", justifyContent: "center" }}>
                {onde === "topo" ? <Acima size={18} /> : <Abaixo size={18} />}
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 12, padding: 24 }}>
          <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600", textAlign: "center" }}>Comparar modelos</Text>
          <Text style={[s.muted, { textAlign: "center" }]}>O mesmo prompt em 2 a 6 modelos, lado a lado. Ou escolha uma bateria de teste pronta:</Text>
          {Object.entries(baterias).map(([id, b]) => (
            <Pressable key={id} onPress={() => { setBateria({ id, b }); setPrompt(b.prompt); }}
                       style={{ borderColor: bateria?.id === id ? c.fg : c.line, borderWidth: 1, borderRadius: 14, padding: 12, gap: 2 }}>
              <Text style={s.txt}>{b.titulo}</Text>
              <Text style={s.faint} numberOfLines={2}>Mede {b.mede}{b.anexo ? ` · anexo ${b.anexo.nome}` : ""}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {!!erro && <Text style={[s.muted, { color: c.red, paddingHorizontal: 14 }]} onPress={() => setErro("")}>{erro}</Text>}
      {!teste && (
        <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
          <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
            {bateria && (
              <Pressable onPress={() => { setBateria(null); setPrompt(""); }} style={{ paddingHorizontal: 8 }}>
                <Text style={{ color: c.amber, fontSize: 12.5 }}>Bateria: {bateria.b.titulo}{bateria.b.gabarito ? " · com gabarito para o revisor" : ""}  ✕</Text>
              </Pressable>
            )}
            <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={prompt}
                       onChangeText={setPrompt} multiline placeholder="Prompt para todos os modelos" placeholderTextColor={c.faint} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
                <Chip rotulo={aj.modelos.length ? `${aj.modelos.length} modelos` : "Escolher modelos"} icone={<Cubo size={13} color={c.muted} />}
                      onPress={() => setFolha("modelos")} />
                <Chip rotulo={aj.modelos.some((m) => m.path) ? "Sequencial" : aj.modo === "paralelo" ? "Paralelo" : "Sequencial"} onPress={() => setFolha("ajustes")} />
                <Chip rotulo={aj.cego ? "Cego" : "Nomes à vista"} ativo={aj.cego} onPress={() => muda({ cego: !aj.cego })} />
                <Chip rotulo="Revisar ao terminar" ativo={aj.autoJulgar}
                      onPress={() => (aj.juiz ? muda({ autoJulgar: !aj.autoJulgar }) : setFolha("ajustes"))} />
                <Chip rotulo="Placar" onPress={() => { setFolha("placar"); api.get<any>("/comparar/placar").then((r) => setPlacar(r.linhas)).catch(() => {}); }} />
              </ScrollView>
              {rodando ? (
                <Pressable onPress={() => acao("cancelar")} style={redondo}><Parar size={16} color="#000" /></Pressable>
              ) : (
                <Pressable onPress={() => roda()} disabled={!pode} style={[redondo, { opacity: pode ? 1 : 0.35 }]}><Enviar size={18} color="#000" /></Pressable>
              )}
            </View>
          </View>
        </View>
      )}
      <Modelos aberto={folha === "modelos"} max={6} marcados={aj.modelos} onFecha={() => setFolha(null)}
               onEscolhe={(e) => { muda({ modelos: e }); setFolha(null); }} />
      <Modelos aberto={folha === "juiz"} soProvedor onFecha={() => setFolha(null)}
               onEscolhe={([e]) => { muda({ juiz: e, autoJulgar: aj.autoJulgar || !aj.juiz }); setFolha(null); }} /> {/* 1º revisor já liga o "Revisar ao terminar" */}
      <Modelos aberto={folha === "adicionar"} onFecha={() => setFolha(null)}
               onEscolhe={([e]) => {
                 setFolha(null);
                 if (aj.modelos.some((m) => chave(m) === chave(e))) return;
                 acao("adicionar", e.path ? { path: e.path } : { provider: e.provider, model: e.model }); // só o novo gera
               }} />
      <Folha aberta={folha === "ajustes"} titulo="Como rodar" onFecha={() => setFolha(null)}>
        <Campo rotulo="Modo" dica={aj.modelos.some((m) => m.path) ? "Com .gguf é sempre sequencial: carrega um modelo por vez na GPU." : "Paralelo roda todos ao mesmo tempo; sequencial, um de cada vez."}>
          <Seletor opcoes={MODOS} valor={aj.modelos.some((m) => m.path) ? "sequencial" : aj.modo} onMuda={(v) => muda({ modo: v })} />
        </Campo>
        <Opcao rotulo="Modo cego" dica="Os nomes dos modelos ficam escondidos até você votar." valor={aj.cego} onMuda={(v) => muda({ cego: v })} />
        <Opcao rotulo="Revisar ao terminar" valor={aj.autoJulgar} onMuda={(v) => muda({ autoJulgar: v })}
               dica="Quando todas as respostas terminarem, o PC começa o revisor sozinho — mesmo com o celular bloqueado ou o app fechado." />
        <Campo rotulo="Modelo revisor">
          <Chip rotulo={aj.juiz?.nome ?? "Escolher"} icone={<Cubo size={13} color={c.muted} />} onPress={() => setFolha("juiz")} max={260} />
        </Campo>
      </Folha>
      <Folha aberta={folha === "placar"} titulo="Placar" onFecha={() => setFolha(null)}>
        {placar.map((l) => (
          <View key={l.nome} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
            <Text style={[s.txt, { flex: 1, fontSize: 14 }]} numberOfLines={1}>{l.nome}</Text>
            <Text style={[s.muted, { fontFamily: mono, fontSize: 12 }]}>
              {l.vitorias}🏆 {l.rodadas} rod.{l.erros ? ` ${l.erros} erro` : ""}{l.tps ? ` ${l.tps.toFixed(0)} t/s` : ""}
            </Text>
          </View>
        ))}
        {!placar.length && <Text style={s.faint}>Nenhuma comparação votada ainda.</Text>}
      </Folha>
    </View>
  );
}

const redondo = { width: 36, height: 36, borderRadius: 18, backgroundColor: c.fg, alignItems: "center" as const, justifyContent: "center" as const };
