import * as Clipboard from "expo-clipboard";
import { File as ArquivoLocal, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Text, TextInput } from "./Texto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, cancelado, lerAjustes, type Msg, salvaAjustes, streamSSE } from "./api";
import type { Conv } from "./Chat";
import { Balanca, Brain, Check, Copy, Cube, Download, Eye, EyeOff, Gauge, Play, Plus, Refresh, Split, Star, Voltar, X } from "./icones";
import { BotaoEnviar } from "./Imagens";
import Markdown from "./Markdown";
import Modelos, { chave, type Escolha } from "./Modelos";
import { Terminal } from "./Painel";
import Site from "./Site";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Botao, Chip, Gira, Opcao, Pulsa, toast } from "./ui";

// CompararItem / CompararEstado / julgamento do desktop (types.ts, comparar.py, baterias.py).
type Item = { id: string; rotulo: string; nome: string; status: string; content: string; reasoning?: string;
              stats?: { tokens?: number; seconds?: number; tps?: number }; error?: string };
type Estado = { message_id: number; status: string; modo: string; cego?: boolean; revelado?: boolean; voto?: string | null; itens: Item[] };
type Juizo = { status: string; juiz?: string; passos?: string[]; texto?: string; pensou?: string; erro?: string;
               stats?: { tokens?: number; seconds?: number; tps?: number } | null };
type Bateria = { titulo: string; mede: string; prompt: string; gabarito?: string; anexo?: { nome: string } | null };
type Ajustes = { modelos: Escolha[]; modo: "paralelo" | "sequencial"; cego: boolean; juiz: Escolha | null; autoJulgar: boolean };
type Placar = { nome: string; rodadas: number; vitorias: number; erros: number; tps: number | null };

const COR: Record<string, string> = { pronto: c.ok, erro: c.err, rodando: c.info, carregando: c.warn, cancelado: c.faint, pendente: c.faint };
const n2 = (x: number) => x.toFixed(2).replace(".", ",");

/** Blocos de código da resposta (o que o "Testar" roda), com a linguagem da cerca; o resto é texto. */
function partes(texto: string): ({ tipo: "texto"; t: string } | { tipo: "codigo"; lang: string; codigo: string })[] {
  const out: ({ tipo: "texto"; t: string } | { tipo: "codigo"; lang: string; codigo: string })[] = [];
  let fim = 0;
  for (const m of texto.matchAll(/```([\w+-]*)\n([\s\S]*?)```/g)) {
    if (m.index! > fim) out.push({ tipo: "texto", t: texto.slice(fim, m.index) });
    out.push({ tipo: "codigo", lang: m[1], codigo: m[2] });
    fim = m.index! + m[0].length;
  }
  if (fim < texto.length) out.push({ tipo: "texto", t: texto.slice(fim) });
  return out;
}

/** Salva texto no celular pelo compartilhar do Android (Drive, Arquivos, e-mail…). */
export async function compartilhaTexto(nome: string, texto: string, mime = "text/markdown") {
  const arq = new ArquivoLocal(Paths.cache, nome);
  if (arq.exists) arq.delete();
  arq.create();
  arq.write(texto);
  await Sharing.shareAsync(arq.uri, { mimeType: mime, dialogTitle: "Salvar" });
}

// "Testar" de um Worker (Maestro › Modelo · VRAM): bateria da especialidade e o modelo atual já na lista (preset do desktop).
const BATERIA_DE: Record<string, string> = { logica: "logica", frontend: "frontend", testes: "testes", docs: "docs" };
let preset: { id: string; nome: string; spec?: { provider: string; model: string } } | null = null;
export const testaWorker = (p: NonNullable<typeof preset>) => { preset = p; };

/** Comparar modelos (CompararView do desktop): o mesmo prompt em 2 a 6 modelos, empilhados, com voto, teste do código e revisor. */
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
  const [folha, setFolha] = useState<null | "candidato" | "juiz" | "adicionar">(null);
  const [candidato, setCandidato] = useState<Escolha | null>(null); // modelo a pôr na lista (composer)
  const [paraAdicionar, setParaAdicionar] = useState<Escolha | null>(null); // modelo a somar nesta comparação
  const [placar, setPlacar] = useState<Placar[] | null>(null);
  const [teste, setTeste] = useState<null | { tipo: "web"; servidor: string; caminho: string } | { tipo: "terminal"; comando: string }>(null);
  const [vram, setVram] = useState<{ msg: string; texto: string; criada: number | null } | null>(null);
  const [erro, setErro] = useState("");
  const abort = useRef<AbortController | null>(null);
  const abortJuiz = useRef<AbortController | null>(null);
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
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
    // Os ajustes salvos primeiro: o preset do "Testar" vem por cima deles.
    lerAjustes<Ajustes>("comparar", aj).then((salvo) => { setAj(salvo); return api.get<Record<string, Bateria>>("/comparar/baterias"); }).then((todas) => {
      setBaterias(todas);
      const p = preset;
      preset = null;
      if (!p) return;
      const id = BATERIA_DE[p.id] ?? "geral";
      if (todas[id]) { setBateria({ id, b: todas[id] }); setPrompt(todas[id].prompt); }
      if (p.spec?.model) setAj((a) => ({ ...a, modelos: [{ provider: p.spec!.provider, model: p.spec!.model, nome: p.spec!.model }] }));
    }).catch(() => {});
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

  const temGguf = aj.modelos.some((m) => m.path);
  async function roda(confirm = false, texto = prompt.trim(), jaCriada: number | null = null) {
    if (!texto || aj.modelos.length < 2) return;
    setErro("");
    setVram(null);
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
      setJuizo(null);
      const itens = aj.modelos.map((m) => (m.path ? { path: m.path, nome: m.nome } : { provider: m.provider, model: m.model, nome: m.nome }));
      // .gguf carrega um por vez na VRAM: o desktop trava o sequencial nesse caso.
      const modo = temGguf ? "sequencial" : aj.modo;
      await segue(`/comparar/${id}/rodar`, { prompt: texto, itens, modo, cego: aj.cego, confirm, bateria: bateria?.id ?? "",
        revisor: aj.autoJulgar && aj.juiz?.model ? { provider: aj.juiz.provider, model: aj.juiz.model } : null });
    } catch (e: any) {
      if (e.status === 409 && !confirm) { setPrompt(texto); return setVram({ msg: e.message, texto, criada }); }
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

  async function testa(it: Item, cod: { codigo: string; lang: string }) {
    if (!estado) return;
    try {
      const r = await api.post<any>("/comparar/testar", { codigo: cod.codigo, linguagem: cod.lang, chave: `${estado.message_id}-${it.rotulo}`,
        conv: convId, bateria: bateria?.id ?? "" }, 60000);
      // Regex e não `new URL(...).pathname`: o URL do React Native não implementa pathname.
      if (r.tipo === "web") setTeste({ tipo: "web", servidor: r.servidor, caminho: String(r.url).replace(/^https?:\/\/[^/]+/, "") });
      else setTeste({ tipo: "terminal", comando: r.comando });
    } catch (e: any) { setErro(e.message); }
  }

  const cegoAtivo = !!estado?.cego && !estado.revelado;
  const nomeDe = (it: Item) => (cegoAtivo ? `Modelo ${it.rotulo}` : it.nome);
  const markdown = () => estado ? [`# Comparação`, "", `> ${pedido}`, "",
    ...estado.itens.flatMap((it) => [`## ${nomeDe(it)}`, "", it.content || it.error || "", "",
      it.stats?.tokens ? `_${it.stats.tps ? `${n2(it.stats.tps)} tok/s · ` : ""}${it.stats.seconds ? `${n2(it.stats.seconds)} s · ` : ""}${it.stats.tokens} tokens_` : "", ""]),
    ...(juizo?.texto ? ["## Análise", "", juizo.texto] : [])].join("\n") : "";
  const abrePlacar = () => (placar ? setPlacar(null) : api.get<{ linhas: Placar[] }>("/comparar/placar").then((r) => setPlacar(r.linhas)).catch((e) => setErro(e.message)));
  const pode = !!prompt.trim() && aj.modelos.length >= 2;

  if (teste)
    return (
      <View style={{ flex: 1, paddingBottom: teclado }}>
        <Pressable onPress={() => setTeste(null)} style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 12 }}>
          <Voltar size={16} color={c.muted} /><Text style={s.muted}>Voltar à comparação</Text>
        </Pressable>
        {teste.tipo === "web" ? <Site nome={teste.servidor} caminho={teste.caminho} /> : convId != null && <Terminal conv={convId} comando={teste.comando} />}
      </View>
    );

  const meta = estado ? [`${estado.itens.length} modelos`, estado.modo === "sequencial" ? "um de cada vez" : "ao mesmo tempo", estado.cego ? "modo cego" : ""]
    .filter(Boolean).join(" · ") : "";
  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 14, gap: 12, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {estado ? (
          <>
            <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 12, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={s.secao2}>PROMPT</Text>
                <Text style={{ color: c.faint, fontSize: 11.5, flex: 1 }} numberOfLines={1}>{meta}</Text>
                <Pressable hitSlop={8} onPress={() => setPrompt(pedido)}><Text style={{ color: c.accentText, fontSize: 12.5 }}>Reusar</Text></Pressable>
              </View>
              <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 21 }} selectable>{pedido}</Text>
            </View>

            {placar && (
              <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 12, gap: 6 }}>
                <Text style={s.secao2}>PLACAR</Text>
                {placar.map((l) => (
                  <View key={l.nome} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 }}>
                    <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{l.nome}</Text>
                    <Star size={12} color={c.amber} cheia />
                    <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12 }}>{l.vitorias}</Text>
                    <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{l.rodadas} rod.</Text>
                    {l.tps != null && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{Math.round(l.tps)} tok/s</Text>}
                    {!!l.erros && <Text style={{ color: c.err, fontFamily: mono, fontSize: 12 }}>{l.erros} erro{l.erros > 1 ? "s" : ""}</Text>}
                  </View>
                ))}
                {!placar.length && <Text style={s.faint}>Nenhuma comparação votada ainda.</Text>}
              </View>
            )}

            {estado.itens.map((it) => (
              <Resposta key={it.id} it={it} nome={nomeDe(it)} cego={cegoAtivo} votado={estado.voto === it.id} rodando={rodando}
                        onVotar={() => vota(it.id)} onRefazer={() => acao("refazer", { item: it.id })} onTestar={(cod) => testa(it, cod)}
                        onRemover={estado.itens.length > 2 && !rodando ? () => acao("remover", { item: it.id }) : undefined} />
            ))}

            {estado.itens.length < 6 && !rodando && (
              <View style={{ gap: 8 }}>
                <Text style={[s.muted, { fontSize: 12.5 }]}>Adicionar a esta comparação (só ele gera):</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setFolha("adicionar")} style={{ flex: 1, height: 38, borderRadius: 999, backgroundColor: c.raised, flexDirection: "row",
                                                                            alignItems: "center", gap: 6, paddingHorizontal: 12 }}>
                    <Cube size={14} color={c.muted} />
                    <Text style={{ color: paraAdicionar ? c.fg : c.faint, fontSize: 13, fontFamily: mono, flex: 1 }} numberOfLines={1}>{paraAdicionar?.nome ?? "Escolher modelo"}</Text>
                  </Pressable>
                  <Botao rotulo="Adicionar" desabilitado={!paraAdicionar} icone={<Plus size={14} color={c.fg} />} onPress={() => {
                    const e = paraAdicionar!;
                    setParaAdicionar(null);
                    acao("adicionar", e.path ? { path: e.path } : { provider: e.provider, model: e.model });
                  }} />
                  {estado.modo === "sequencial" && <Botao rotulo="+ .gguf" onPress={() => setFolha("adicionar")} />}
                </View>
              </View>
            )}

            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Botao rotulo="Copiar Markdown" icone={<Copy size={14} color={c.fg} />}
                       onPress={() => Clipboard.setStringAsync(markdown()).then(() => toast("Markdown copiado."))} />
                <Botao rotulo="Baixar .md" icone={<Download size={14} color={c.fg} />}
                       onPress={() => compartilhaTexto(`comparacao-${estado.message_id}.md`, markdown()).catch((e) => setErro(e.message))} />
                <Botao rotulo="Placar" icone={<Gauge size={14} color={placar ? c.accentText : c.fg} />} onPress={abrePlacar} />
              </View>
              <Text style={[s.faint, { fontSize: 12 }]}>Toque em Testar num bloco de código para vê-lo rodando.</Text>
            </View>

            <Analise juizo={juizo} juiz={aj.juiz} auto={aj.autoJulgar} rodandoComp={rodando} bateria={!!bateria}
                     onAuto={(v) => muda({ autoJulgar: v })} onJuiz={() => setFolha("juiz")} onAnalisar={julgar}
                     onParar={() => api.post(`/comparar/${estado.message_id}/julgar/parar`).catch((e) => setErro(e.message))} />
          </>
        ) : (
          <View style={{ flex: 1, justifyContent: "center", gap: 12, paddingVertical: 12 }}>
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600", textAlign: "center" }}>Comparar modelos</Text>
            <Text style={[s.muted, { textAlign: "center", lineHeight: 19 }]}>O mesmo prompt em 2 a 6 modelos, uma resposta embaixo da outra. Ou escolha uma bateria de teste pronta:</Text>
            {Object.entries(baterias).map(([id, b]) => (
              <Pressable key={id} onPress={() => { setBateria({ id, b }); setPrompt(b.prompt); }}
                         style={{ borderColor: bateria?.id === id ? c.accentLine : c.line, backgroundColor: bateria?.id === id ? c.accentSoft : c.surface,
                                  borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 }}>
                <Text style={{ color: c.fg, fontSize: 14.5 }}>{b.titulo}</Text>
                <Text style={[s.faint, { fontSize: 12.5 }]} numberOfLines={2}>Mede {b.mede}{b.anexo ? ` · anexo ${b.anexo.nome}` : ""}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!erro && <Text style={[s.muted, { color: c.err }]} onPress={() => setErro("")}>{erro}</Text>}
      </ScrollView>

      {vram && (
        <View style={{ marginHorizontal: 12, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: "rgba(242,161,74,0.45)", backgroundColor: c.warnSoft,
                       padding: 12, gap: 10 }}>
          <Text style={{ color: c.fg2, fontSize: 13, lineHeight: 19 }}>{vram.msg}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao primario rotulo="Descarregar e comparar" onPress={() => roda(true, vram.texto, vram.criada)} />
            <Botao rotulo="Cancelar" onPress={() => setVram(null)} />
          </View>
        </View>
      )}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          {aj.modelos.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 4, paddingTop: 2 }}>
              {aj.modelos.map((m) => (
                <View key={chave(m)} style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 28, borderRadius: 999, backgroundColor: c.raised,
                                              paddingLeft: 10, paddingRight: 6 }}>
                  <Text style={{ color: c.fg2, fontFamily: mono, fontSize: 12, maxWidth: 150 }} numberOfLines={1}>{m.nome}</Text>
                  <Pressable hitSlop={8} onPress={() => muda({ modelos: aj.modelos.filter((x) => chave(x) !== chave(m)) })}><X size={12} color={c.faint} /></Pressable>
                </View>
              ))}
            </View>
          ) : <Text style={[s.faint, { fontSize: 12.5, paddingHorizontal: 8, paddingTop: 2 }]}>Escolha de 2 a 6 modelos no seletor abaixo.</Text>}
          {bateria && (
            <Pressable onPress={() => { setBateria(null); setPrompt(""); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
              <Text style={{ color: c.amber, fontSize: 12.5, flex: 1 }} numberOfLines={1}>Bateria: {bateria.b.titulo}{bateria.b.gabarito ? " · com gabarito para o revisor" : ""}</Text>
              <X size={13} color={c.amber} />
            </Pressable>
          )}
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 4 }} value={prompt}
                     onChangeText={setPrompt} multiline placeholderTextColor={c.faint}
                     placeholder={estado ? "Novo prompt para comparar…" : "O prompt que todos os modelos vão responder…"} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={temGguf || aj.modo === "sequencial" ? "Sequencial" : "Paralelo"} icone={<Split size={14} color={c.muted} />}
                    onPress={() => (temGguf ? toast("Com .gguf é sempre sequencial: carrega um modelo por vez na GPU.") : muda({ modo: aj.modo === "paralelo" ? "sequencial" : "paralelo" }))} />
              <Chip rotulo="Modo cego" ativo={aj.cego} icone={aj.cego ? <EyeOff size={14} color={c.accentText} /> : <Eye size={14} color={c.muted} />}
                    onPress={() => muda({ cego: !aj.cego })} />
              <Chip rotulo="Revisar ao terminar" ativo={aj.autoJulgar} icone={<Balanca size={14} color={aj.autoJulgar ? c.accentText : c.muted} />}
                    onPress={() => (aj.juiz ? muda({ autoJulgar: !aj.autoJulgar }) : setFolha("juiz"))} />
              <Chip rotulo="+ .gguf" icone={<Plus size={14} color={c.muted} />} onPress={() => setFolha("candidato")} />
              <Chip rotulo={candidato?.nome ?? "Modelo"} icone={<Cube size={14} color={c.muted} />} onPress={() => setFolha("candidato")} />
              <Chip rotulo="Adicionar" icone={<Plus size={14} color={candidato ? c.accentText : c.faint} />} cor={candidato ? c.accentText : c.faint}
                    onPress={() => {
                      if (!candidato || aj.modelos.length >= 6 || aj.modelos.some((m) => chave(m) === chave(candidato))) return;
                      muda({ modelos: [...aj.modelos, candidato] });
                      setCandidato(null);
                    }} />
            </ScrollView>
            {rodando ? (
              <Pressable onPress={() => acao("cancelar")} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: c.accentFg }} />
              </Pressable>
            ) : <BotaoEnviar pode={pode} onPress={() => roda()} />}
          </View>
        </View>
      </View>
      <Modelos aberto={folha === "candidato"} onFecha={() => setFolha(null)} onEscolhe={([e]) => { setCandidato(e); setFolha(null); }} />
      <Modelos aberto={folha === "juiz"} soProvedor onFecha={() => setFolha(null)}
               onEscolhe={([e]) => { muda({ juiz: e, autoJulgar: aj.autoJulgar || !aj.juiz }); setFolha(null); }} /> {/* 1º revisor já liga o "Revisar ao terminar" */}
      <Modelos aberto={folha === "adicionar"} onFecha={() => setFolha(null)}
               onEscolhe={([e]) => { setFolha(null); if (!estado?.itens.some((i) => i.nome === e.nome)) setParaAdicionar(e); }} />
    </View>
  );
}

/** Uma resposta: status, nome (ou Modelo A no cego), Refazer, Votar; raciocínio recolhível; código com Testar; números no rodapé. */
function Resposta({ it, nome, cego, votado, rodando, onVotar, onRefazer, onTestar, onRemover }: {
  it: Item; nome: string; cego: boolean; votado: boolean; rodando: boolean; onVotar: () => void; onRefazer: () => void;
  onTestar: (cod: { codigo: string; lang: string }) => void; onRemover?: () => void;
}) {
  const [pensou, setPensou] = useState(false);
  const ativo = ["rodando", "carregando"].includes(it.status);
  const bt = { height: 28, borderRadius: 7, borderWidth: 1, borderColor: c.lineStrong, paddingHorizontal: 9, flexDirection: "row" as const,
               alignItems: "center" as const, gap: 5 };
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: votado ? c.accentLine : c.line, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, paddingBottom: 8 }}>
        <Pulsa cor={COR[it.status] ?? c.faint} ativo={ativo} />
        <Text style={{ color: c.fg, fontFamily: cego ? undefined : mono, fontSize: 12.5, fontWeight: "600", flex: 1 }} numberOfLines={1}>{nome}</Text>
        {!rodando && (
          <Pressable style={bt} onPress={onRefazer}><Refresh size={12} color={c.fg2} /><Text style={{ color: c.fg2, fontSize: 12 }}>Refazer</Text></Pressable>
        )}
        {it.status === "pronto" && !rodando && (
          votado ? (
            <Pressable onPress={onVotar} style={[bt, { backgroundColor: c.accent, borderColor: c.accent }]}>
              <Star size={12} color={c.accentFg} cheia /><Text style={{ color: c.accentFg, fontSize: 12, fontWeight: "600" }}>Melhor resposta</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onVotar} style={bt}><Star size={12} color={c.fg2} /><Text style={{ color: c.fg2, fontSize: 12 }}>Votar</Text></Pressable>
          )
        )}
      </View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
        {!!it.reasoning && (
          <View style={{ gap: 6 }}>
            <Pressable onPress={() => setPensou(!pensou)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Brain size={14} color={c.faint} />
              <Text style={{ color: c.faint, fontSize: 13 }}>Raciocínio{ativo && !it.content ? "…" : ""}</Text>
              <Gira aberto={pensou} size={13} color={c.faint} />
            </Pressable>
            {pensou && <Text style={{ color: c.faint, fontSize: 12.5, lineHeight: 19 }} selectable>{it.reasoning}</Text>}
          </View>
        )}
        {!!it.error && <Text style={{ color: c.err, fontSize: 13 }}>{it.error}</Text>}
        {it.content ? partes(it.content).map((p, i) => p.tipo === "texto" ? <Markdown key={i} texto={p.t} /> : (
          <BlocoTestavel key={i} lang={p.lang} codigo={p.codigo} onTestar={it.status === "pronto" ? () => onTestar(p) : undefined} />
        )) : !it.error && !it.reasoning && <Text style={s.faint}>{ativo ? "Gerando…" : "Aguardando…"}</Text>}
        {!!onRemover && <Text onPress={onRemover} style={{ color: c.faint, fontSize: 12.5 }}>Remover da comparação</Text>}
      </View>
      {!!it.stats?.tokens && (
        <Text style={{ borderTopWidth: 1, borderTopColor: c.line, paddingHorizontal: 12, paddingVertical: 8, color: c.faint, fontFamily: mono, fontSize: 11.5 }}>
          {[it.stats.tps != null ? `${n2(it.stats.tps)} tok/s` : "", it.stats.seconds != null ? `${n2(it.stats.seconds)} s` : "",
            `${it.stats.tokens.toLocaleString("pt-BR")} tokens`].filter(Boolean).join(" · ")}
        </Text>
      )}
    </View>
  );
}

/** Bloco de código da resposta: linguagem, Testar e Copiar; limitado a 150 px com "Ver o código inteiro". */
function BlocoTestavel({ lang, codigo, onTestar }: { lang: string; codigo: string; onTestar?: () => void }) {
  const [inteiro, setInteiro] = useState(false);
  const longo = codigo.split("\n").length > 8;
  return (
    <View style={{ backgroundColor: c.code, borderRadius: 12, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5, flex: 1 }}>{lang || "código"}</Text>
        {onTestar && (
          <Pressable onPress={onTestar} style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 9, borderRadius: 7, backgroundColor: c.raised }}>
            <Play size={11} color={c.fg} /><Text style={{ color: c.fg, fontSize: 12 }}>Testar</Text>
          </Pressable>
        )}
        <Pressable hitSlop={10} onPress={() => Clipboard.setStringAsync(codigo).then(() => toast("Código copiado."))}><Copy size={13} color={c.muted} /></Pressable>
      </View>
      <ScrollView horizontal style={{ maxHeight: inteiro ? undefined : 150 }} contentContainerStyle={{ padding: 12 }}>
        <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12.5, lineHeight: 19 }} selectable>{codigo}</Text>
      </ScrollView>
      {longo && (
        <Pressable onPress={() => setInteiro(!inteiro)} style={{ borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 7, alignItems: "center" }}>
          <Text style={{ color: c.accentText, fontSize: 12.5 }}>{inteiro ? "Recolher" : "Ver o código inteiro"}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ponytail: ícone por palavra-chave na linha do revisor; trocar quando o julgamento vier estruturado do PC.
const iconeLinha = (l: string) => /(✓|✅|\bcorret|\bcert|passou|melhor|vence)/i.test(l) ? <Check size={14} color={c.ok} />
  : /(✗|❌|\berr|falh|pior|quebr)/i.test(l) ? <X size={14} color={c.err} /> : <Gauge size={14} color={c.muted} />;

function Analise({ juizo, juiz, auto, rodandoComp, bateria, onAuto, onJuiz, onAnalisar, onParar }: {
  juizo: Juizo | null; juiz: Escolha | null; auto: boolean; rodandoComp: boolean; bateria: boolean; onAuto: (v: boolean) => void;
  onJuiz: () => void; onAnalisar: () => void; onParar: () => void;
}) {
  const rodando = juizo?.status === "rodando";
  const linhas = (juizo?.texto ?? "").split("\n");
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 12, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Balanca size={16} color={c.fg} />
        <Text style={s.secao2}>ANALISAR COM IA</Text>
      </View>
      <Text style={[s.muted, { lineHeight: 19 }]}>Um modelo que você confia lê as respostas{bateria ? ", o gabarito da bateria" : ""} e as estatísticas e compara.</Text>
      <Opcao rotulo="Revisar ao terminar" dica="O PC começa o revisor sozinho, mesmo com o app fechado." valor={auto} onMuda={onAuto} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={onJuiz} style={{ flex: 1, height: 38, borderRadius: 999, backgroundColor: c.raised, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 }}>
          <Cube size={14} color={c.muted} />
          <Text style={{ color: juiz ? c.fg : c.faint, fontFamily: mono, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{juiz?.nome ?? "Modelo revisor"}</Text>
        </Pressable>
        {rodando ? <Botao rotulo="Parar" onPress={onParar} />
          : <Botao primario rotulo={juizo?.texto ? "Analisar de novo" : "Analisar"} desabilitado={rodandoComp} onPress={onAnalisar} />}
      </View>
      {rodando && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" color={c.muted} />
          <Text style={s.muted}>{juizo?.passos?.[juizo.passos.length - 1] ?? "Analisando as respostas…"}</Text>
        </View>
      )}
      {!!juizo?.texto && (
        <View style={{ gap: 8 }}>
          {linhas.map((l, i) => /^\s*[-*]\s+/.test(l) ? (
            <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <View style={{ paddingTop: 4 }}>{iconeLinha(l)}</View>
              <View style={{ flex: 1 }}><Markdown texto={l.replace(/^\s*[-*]\s+/, "")} /></View>
            </View>
          ) : l.trim() ? <Markdown key={i} texto={l} /> : null)}
        </View>
      )}
      {!!juizo?.stats?.tokens && !rodando && (
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{juizo.juiz} · {juizo.stats.tokens.toLocaleString("pt-BR")} tokens · {Math.round(juizo.stats.seconds ?? 0)} s</Text>
      )}
      {!!juizo?.erro && <Text style={{ color: c.err, fontSize: 13 }}>{juizo.erro}</Text>}
    </View>
  );
}
