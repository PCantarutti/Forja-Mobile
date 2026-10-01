import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "./Texto";
import { api, cancelado, enviaArquivo, lerAjustes, salvaAjustes, streamSSE } from "./api";
import type { Conv } from "./Chat";
import { ArrowRight, Check, Cube, Globo, Livro, Paperclip, Prancheta, Search, X } from "./icones";
import { BotaoEnviar } from "./Imagens";
import Modelos, { type Escolha } from "./Modelos";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Area, Botao, Chip, Folha, Lista, Pulsa, Seletor, toast } from "./ui";
import { DocumentoRico, type DocumentoRef, sumario } from "./Formula";
import EstudosMapaMental from "./EstudosMapaMental";
import { type Aba, type Casca, type EstudosEstado, type EstudosPreferencias, type EstudosProjeto, type Exec, type Modelo,
         type Pendente, type ProvaPendente, PEDIDO_CLAUDE, numeros } from "./estudosTipos";
import Provas from "./EstudosProva";
import Duvidas from "./EstudosDuvidas";
import Revisao from "./EstudosRevisao";
import Desempenho from "./EstudosDesempenho";

// Tela Estudos do Forja Desktop (EstudosView) no celular: o resumo da matéria (com as fórmulas), as provas e o
// treino, as dúvidas, a revisão (caderno de erros e flashcards) e o desempenho. Tudo pelas mesmas rotas
// /api/estudos do PC; o /activity mantém os dois lados iguais, ao vivo (padrão do Design.tsx).

type Ajustes = { escritor: Escolha | null; extrator: Escolha | null; prefs: EstudosPreferencias; web: boolean; prof: EstudosEstado["profundidade"] };
const PREFS: EstudosPreferencias = { nivel: "intermediario", objetivo: "entender", tom: "didatico", tamanho: "medio", extras: ["exemplos", "pegadinhas"], observacoes: "" };
const NIVEIS = [{ id: "iniciante", rotulo: "Iniciante" }, { id: "intermediario", rotulo: "Intermediário" }, { id: "avancado", rotulo: "Avançado" }] as const;
const OBJETIVOS = [{ id: "vestibular", rotulo: "Vestibular/ENEM" }, { id: "concurso", rotulo: "Concurso" }, { id: "faculdade", rotulo: "Faculdade" }, { id: "entender", rotulo: "Entender" }] as const;
const TONS = [{ id: "direto", rotulo: "Direto" }, { id: "didatico", rotulo: "Didático" }, { id: "formal", rotulo: "Formal" }] as const;
const TAMANHOS = [{ id: "curto", rotulo: "Curto" }, { id: "medio", rotulo: "Médio" }, { id: "completo", rotulo: "Completo" }] as const;
const EXTRAS = [{ id: "exemplos", rotulo: "Exemplos resolvidos" }, { id: "mnemonicos", rotulo: "Mnemônicos" }, { id: "pegadinhas", rotulo: "Pegadinhas" }, { id: "quadro", rotulo: "Quadro-resumo" }] as const;
const PROFUNDIDADES = [
  { id: "rapida", rotulo: "Rápida", dica: "1 rodada, 3 páginas" },
  { id: "normal", rotulo: "Normal", dica: "2 rodadas, 5 páginas por rodada" },
  { id: "funda", rotulo: "Funda", dica: "4 rodadas, 8 páginas por rodada — demora" },
] as const;
const ETAPAS = [{ id: "material", rotulo: "Material" }, { id: "web", rotulo: "Web" }, { id: "plano", rotulo: "Roteiro" }, { id: "escrita", rotulo: "Escrita" }];
const MARCA_TOPICO: Record<string, string> = { fila: "·", escrevendo: "›", pronto: "✓", erro: "✕" };

export default function Estudos({ conv, onCriada, onTurno }: { conv: Conv | null; onCriada: (c: Conv) => void; onTurno: () => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [p, setP] = useState<EstudosProjeto | null>(null);
  const [exec, setExec] = useState<Exec | null>(null);
  const [aba, setAba] = useState<Aba>("resumo");
  const [imersao, setImersao] = useState(false);
  const [tema, setTema] = useState("");
  const [aj, setAj] = useState<Ajustes>({ escritor: null, extrator: null, prefs: PREFS, web: true, prof: "rapida" });
  const [folha, setFolha] = useState<null | "prefs" | "prof" | "modelos" | "escritor" | "extrator" | "material" | "colar" | "sumario">(null);
  const [colado, setColado] = useState("");
  const [lendo, setLendo] = useState(0);        // arquivos sendo enviados/extraídos (OCR demora)
  const [fimVisto, setFimVisto] = useState<number | null>(null);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [provaPendente, setProvaPendente] = useState<ProvaPendente | null>(null);
  const [erro, setErro] = useState("");
  const abort = useRef<AbortController | null>(null);
  const doc = useRef<DocumentoRef>(null);
  const [mapa, setMapa] = useState(false);   // o resumo como mapa mental
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const muda = (x: Partial<Ajustes>) => setAj((a) => { const n = { ...a, ...x }; salvaAjustes("estudos", n); return n; });

  const carrega = useCallback(async (id = convId): Promise<EstudosProjeto | null> => {
    if (id == null) { setP(null); return null; }
    try { const np = await api.get<EstudosProjeto>(`/estudos/${id}`); setP(np); return np; } catch (e: any) { setErro(e.message); return null; }
  }, [convId]);

  /** Acompanha uma execução (POST que responde em SSE, ou o GET .../stream de uma que o PC disparou). */
  const segue = useCallback(async (path: string, body?: unknown) => {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    let ultimo: Exec | null = null;
    try {
      await streamSSE(path, (ev) => { if (ev.erro) setErro(ev.erro); else { ultimo = ev; setExec(ev); } }, ac.signal, body);
    } catch (e: any) {
      if (!ac.signal.aborted && !cancelado(e)) setErro(e.message);
    } finally {
      if (!ac.signal.aborted) {
        const np = await carrega();
        setExec(null); onTurno();
        // o stream caiu (rede, suspensão) com a execução ainda viva no PC: volta a acompanhar
        if (!ac.signal.aborted && np?.rodando) segue(`/estudos/execucao/${np.rodando}/stream`);
      }
    }
    return ultimo;
  }, [carrega, onTurno]);

  // Modelo: o guardado para Estudos, senão o do chat do celular, senão o último do PC (como a Pesquisa).
  useEffect(() => {
    Promise.all([lerAjustes<Ajustes>("estudos", aj), lerAjustes<{ provider: string; model: string }>("modelo", { provider: "", model: "" }),
      api.get<{ defaults: Record<string, string> }>("/mobile").catch(() => ({ defaults: {} as Record<string, string> }))])
      .then(([salvo, m, { defaults: d }]) => {
        const x = m.model ? m : d;
        setAj({ ...salvo, prefs: { ...PREFS, ...salvo.prefs }, escritor: salvo.escritor ?? (x.model ? { provider: x.provider, model: x.model, nome: x.model } : null) });
      });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Trocar de conversa derruba o stream da anterior — menos quando a "troca" é a conversa que garante()
  // acabou de criar para a execução que já está no ar.
  const criada = useRef<number | null>(null);
  useEffect(() => {
    carrega();
    return () => { if (criada.current !== convId) abort.current?.abort(); };
  }, [convId]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Execução que o PC disparou (ou que já rodava ao abrir): acompanha pelo stream.
  useEffect(() => { if (p?.rodando && !exec) segue(`/estudos/execucao/${p.rodando}/stream`); }, [p?.rodando]);   // eslint-disable-line react-hooks/exhaustive-deps
  // O tema do último resumo volta para o campo: refazer é um toque.
  useEffect(() => { if (p?.resumo?.tema) setTema((t) => t || p.resumo!.tema); }, [p?.resumo?.message_id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Ao vivo com o PC: o carimbo da lista no /activity muda quando o estudo muda em qualquer aparelho.
  const carimbo = useRef<string | undefined>(undefined);
  const [carimboVisto, setCarimboVisto] = useState<string | undefined>(undefined);
  // Segue olhando mesmo com execução acompanhada: dúvidas respondidas no PC e marcações de revisão/cronograma
  // chegam na hora (o efeito do rodando não abre stream em dobro porque exige !exec).
  useEffect(() => {
    if (convId == null) return;
    const olha = () => api.get<{ lista?: string }>("/activity").then((a) => {
      if (carimbo.current !== undefined && a.lista && a.lista !== carimbo.current) { carrega(); setCarimboVisto(a.lista); }
      carimbo.current = a.lista;
    }).catch(() => {});
    olha();
    const t = setInterval(olha, 3000);
    return () => clearInterval(t);
  }, [convId, carrega]);
  // O SSE morre com o app suspenso: ao voltar, derruba o que ficou pendurado e reabre pelo projeto (como o Chat).
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (st) => {
      if (st !== "active") return;
      abort.current?.abort();
      setExec(null);
      const np = await carrega();
      if (np?.rodando) segue(`/estudos/execucao/${np.rodando}/stream`);
    });
    return () => sub.remove();
  }, [carrega, segue]);
  // Acabou (aqui ou no PC): a faixa de fim do resumo aparece de novo.
  const rodava = useRef(false);
  useEffect(() => {
    if (rodava.current && !exec) setFimVisto(null);
    rodava.current = !!exec;
  }, [exec]);

  const modelo: Modelo | null = aj.escritor?.model
    ? { provider: aj.escritor.provider ?? "", model: aj.escritor.model, ex_provider: aj.extrator?.provider ?? "", ex_model: aj.extrator?.model ?? "" }
    : null;

  const garante = useCallback(async () => {
    if (convId != null) return convId;
    const nova = await api.post<Conv>("/conversations", { kind: "estudos" });
    criada.current = nova.id;
    onCriada(nova);
    setConvId(nova.id);
    return nova.id;
  }, [convId, onCriada]);

  const casca: Casca = { conv: convId, garante, p, exec, segue, recarrega: async () => { await carrega(); }, modelo, carimbo: carimboVisto, erro: setErro, setAba, setImersao };

  async function estudar() {
    const t = tema.trim();
    if (!t || exec) return;
    if (!modelo) return toast("Escolha um modelo em Modelos (ou no chat) antes.");
    setErro("");
    try {
      const id = await garante();
      setFimVisto(null);
      await segue(`/estudos/${id}/estudar`, { tema: t, preferencias: aj.prefs, web: aj.web, profundidade: aj.prof, ...modelo });
    } catch (e: any) { if (!cancelado(e)) setErro(e.message); }
  }

  async function anexar() {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }).catch(() => null);
    if (!r || r.canceled) return;
    setLendo(r.assets.length);
    try {
      const id = await garante();
      for (const a of r.assets) {
        await enviaArquivo(`/estudos/${id}/material`, { uri: a.uri, name: a.name, mimeType: a.mimeType });
        setLendo((n) => n - 1);
      }
      await carrega(id);
      toast(r.assets.length === 1 ? "Material anexado." : `${r.assets.length} materiais anexados.`);
    } catch (e: any) { setErro(e.message); } finally { setLendo(0); }
  }

  async function colar() {
    const texto = colado.trim();
    if (!texto) return;
    try {
      const id = await garante();
      await api.post(`/estudos/${id}/material/texto`, { nome: `texto colado ${(p?.materiais.length ?? 0) + 1}.txt`, texto }, 120000);
      setColado(""); setFolha("material");
      await carrega(id);
    } catch (e: any) { setErro(e.message); }
  }

  async function usoDe(id: number, uso: "conteudo" | "prova") {
    try { await api.patch(`/estudos/material/${id}`, { uso }); await carrega(); } catch (e: any) { setErro(e.message); }
  }
  async function remover(id: number) {
    try { await api.del(`/estudos/material/${id}`); await carrega(); } catch (e: any) { setErro(e.message); }
  }

  const resumo = exec?.tipo === "resumo" ? exec : p?.resumo ?? null;
  const rodandoResumo = exec?.tipo === "resumo";
  const aguardando = resumo?.status === "aguardando";
  const texto = resumo?.texto ?? "";
  const secoes = texto ? sumario(texto) : [];
  const etapas = ETAPAS.filter((x) => x.id !== "web" || resumo?.web);
  const atual = resumo?.etapa === "pronto" ? etapas.length : etapas.findIndex((x) => x.id === resumo?.etapa);
  const mostraFim = !!resumo && !rodandoResumo && fimVisto !== resumo.message_id && ["erro", "cancelado"].includes(resumo.status);
  const materiais = p?.materiais ?? [];
  const prefsRotulo = [NIVEIS.find((o) => o.id === aj.prefs.nivel)?.rotulo, TONS.find((o) => o.id === aj.prefs.tom)?.rotulo].join(" · ");

  const abaBtn = (id: Aba, rotulo: string, n?: number) => (
    <Pressable key={id} onPress={() => setAba(id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: aba === id ? c.raised : "transparent" }}>
      <Text style={{ color: aba === id ? c.fg : c.muted, fontSize: 13.5 }}>{rotulo}{n ? ` · ${n}` : ""}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      {!imersao && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, borderBottomColor: c.line, borderBottomWidth: 1 }}
                    contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}>
          {abaBtn("resumo", "Resumo")}
          {abaBtn("provas", "Provas", p?.provas.length)}
          {abaBtn("duvidas", "Dúvidas", p?.duvidas?.geral)}
          {abaBtn("revisao", "Revisão", p?.revisao?.vencem)}
          {abaBtn("desempenho", "Desempenho")}
          {!!exec && exec.tipo !== "resumo" && <Pulsa cor={c.accent} />}
        </ScrollView>
      )}
      {!!erro && <Text style={{ color: c.err, paddingHorizontal: 14, paddingTop: 8, fontSize: 13 }} onPress={() => setErro("")}>{erro}</Text>}

      {aba === "provas" ? <Provas casca={casca} pendente={provaPendente} onPendenteUsado={() => setProvaPendente(null)} />
       : aba === "duvidas" ? <Duvidas casca={casca} pendente={pendente} onPendenteUsado={() => setPendente(null)} />
       : aba === "revisao" ? <Revisao casca={casca} />
       : aba === "desempenho" ? <Desempenho casca={casca} onProva={(x) => { setProvaPendente(x); setAba("provas"); }} />
       : (
        <>
          <View style={{ flex: 1 }}>
            {(rodandoResumo || aguardando || mostraFim || (resumo && resumo.status === "rodando" && !exec)) && resumo && (
              <View style={{ margin: 12, marginBottom: 0, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 }}>
                {aguardando ? (
                  <>
                    <Text style={{ color: c.fg, fontSize: 14.5 }}>Pedido enviado ao Claude</Text>
                    <Text style={[s.muted, { lineHeight: 19 }]}>No Claude Code conectado ao Forja, peça: “{PEDIDO_CLAUDE}”. A tela atualiza sozinha.</Text>
                    <Botao rotulo="Cancelar pedido" icone={<X size={14} color={c.fg} />} onPress={() => api.post(`/estudos/execucao/${resumo.message_id}/cancelar`).then(() => carrega()).catch((e) => setErro(e.message))} />
                  </>
                ) : mostraFim ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: c.warn, fontSize: 13, flex: 1 }}>Resumo {resumo.status === "erro" ? "com erro" : "cancelado"}{resumo.aviso ? ` · ${resumo.aviso}` : ""}</Text>
                    <Pressable hitSlop={10} onPress={() => setFimVisto(resumo.message_id)}><X size={14} color={c.faint} /></Pressable>
                  </View>
                ) : (
                  <>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      {etapas.map((x, i) => {
                        const cor = i < atual ? c.muted : i === atual ? c.info : c.faint;
                        return (
                          <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            {i < atual ? <Check size={12} color={cor} /> : i === atual ? <ArrowRight size={12} color={cor} /> : null}
                            <Text style={{ color: cor, fontSize: 12.5 }}>{x.rotulo}</Text>
                            {i < etapas.length - 1 && <Text style={{ color: c.faint, fontSize: 12.5 }}> ·</Text>}
                          </View>
                        );
                      })}
                      <View style={{ flex: 1 }} />
                      {rodandoResumo && <Pulsa cor={c.info} />}
                    </View>
                    {!!resumo.topicos.length && (
                      <View style={{ gap: 2 }}>
                        {resumo.topicos.map((t, i) => (
                          <Text key={i} style={{ color: t.status === "escrevendo" ? c.info : t.status === "erro" ? c.err : t.status === "pronto" ? c.muted : c.faint, fontSize: 12.5 }}>
                            {MARCA_TOPICO[t.status]} {i + 1}. {t.titulo}
                          </Text>
                        ))}
                      </View>
                    )}
                    <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>
                      {[resumo.etapa === "web" ? `${resumo.stats.uteis} fontes úteis de ${resumo.fontes.length}` : "", numeros(resumo)].filter(Boolean).join(" · ") || "começando…"}
                    </Text>
                    {!!resumo.aviso && <Text style={{ color: c.warn, fontSize: 13 }}>{resumo.aviso}</Text>}
                  </>
                )}
              </View>
            )}

            {!!texto && secoes.length > 1 && (
              <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
                <Seletor valor={mapa ? "mapa" : "texto"} onMuda={(v) => setMapa(v === "mapa")}
                         opcoes={[{ id: "texto", rotulo: "Texto" }, { id: "mapa", rotulo: "Mapa mental" }]} />
              </View>
            )}
            {!!texto && mapa && secoes.length > 1 && (
              <EstudosMapaMental md={texto} tema={resumo?.tema ?? ""}
                                 onAbrir={(i) => { setMapa(false); setTimeout(() => doc.current?.irTitulo(i), 120); }} />
            )}
            {texto ? (
              // o resumo fica montado debaixo do mapa: voltar do mapa já cai na seção, sem recarregar a página
              <View style={{ flex: 1, display: mapa && secoes.length > 1 ? "none" : "flex" }}>
                <DocumentoRico ref={doc} markdown={texto} onExplicar={(trecho) => {
                  setPendente({ pergunta: "Não entendi este trecho. Explique de outro jeito, mais simples, com um exemplo.", trecho });
                  setAba("duvidas");
                }} />
              </View>
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
                {rodandoResumo ? <ActivityIndicator color={c.muted} /> : (
                  <>
                    <Livro size={32} color={c.muted} />
                    <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600" }}>Estudos</Text>
                    <Text style={[s.muted, { textAlign: "center", lineHeight: 19 }]}>
                      Diga o tema e anexe apostilas, slides ou provas antigas. A IA lê tudo, completa com a web se você quiser e
                      escreve um resumo didático; depois vêm as provas, as dúvidas e a revisão.
                    </Text>
                  </>
                )}
              </View>
            )}
            {!!texto && !rodandoResumo && !!resumo && (
              <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5, paddingHorizontal: 14, paddingVertical: 6 }} numberOfLines={1}>
                {[resumo.motor === "claude" ? `feito por ${resumo.stats.escritor}` : `resumo: ${resumo.stats.escritor}`, numeros(resumo)].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>

          <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
            <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
              <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 110, paddingHorizontal: 8, paddingTop: 6 }} value={tema} onChangeText={setTema} multiline
                         placeholder="Qual matéria ou tema você quer estudar?" placeholderTextColor={c.faint} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
                  <Chip icone={lendo ? <ActivityIndicator size="small" color={c.muted} /> : <Paperclip size={14} color={c.muted} />} onPress={anexar} />
                  <Chip rotulo={materiais.length ? `Material · ${materiais.length}` : "Material"} icone={<Prancheta size={14} color={c.muted} />} onPress={() => setFolha("material")} />
                  <Chip rotulo={prefsRotulo} max={180} onPress={() => setFolha("prefs")} />
                  <Chip rotulo="Web" ativo={aj.web} icone={<Globo size={14} color={aj.web ? c.accentText : c.muted} />} onPress={() => muda({ web: !aj.web })} />
                  {aj.web && <Chip rotulo={PROFUNDIDADES.find((x) => x.id === aj.prof)?.rotulo} icone={<Search size={14} color={c.muted} />} onPress={() => setFolha("prof")} />}
                  <Chip rotulo={aj.escritor?.nome ?? "Modelos"} max={160} icone={<Cube size={14} color={c.muted} />} onPress={() => setFolha("modelos")} />
                  {secoes.length > 1 && <Chip rotulo="Sumário" onPress={() => setFolha("sumario")} />}
                </ScrollView>
                {rodandoResumo ? (
                  <Pressable onPress={() => exec && api.post(`/estudos/execucao/${exec.message_id}/cancelar`).catch((e) => setErro(e.message))}
                             style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                    <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: c.accentFg }} />
                  </Pressable>
                ) : <BotaoEnviar pode={!!tema.trim() && !exec && !lendo} onPress={estudar} />}
              </View>
            </View>
          </View>
        </>
      )}

      <Folha aberta={folha === "material"} titulo={`Material · ${materiais.length}`} onFecha={() => setFolha(null)}>
        {materiais.map((m) => (
          <View key={m.id} style={{ gap: 6, borderBottomColor: c.line, borderBottomWidth: 1, paddingBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: c.fg, fontSize: 14.5, flex: 1 }} numberOfLines={1}>{m.nome}</Text>
              <Pressable hitSlop={8} onPress={() => remover(m.id)}><X size={16} color={c.faint} /></Pressable>
            </View>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{[m.paginas ? `${m.paginas} págs` : "", `${Math.round(m.chars / 1000)} mil caracteres`, m.ocr ? "OCR" : "", m.figuras ? `${m.figuras} figura${m.figuras === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</Text>
            <Seletor cheio altura={32} valor={m.uso} opcoes={[{ id: "conteudo", rotulo: "Conteúdo" }, { id: "prova", rotulo: "Prova / simulado" }]} onMuda={(v) => usoDe(m.id, v)} />
          </View>
        ))}
        {!materiais.length && <Text style={[s.muted, { lineHeight: 19 }]}>Apostila, slides, anotações ou uma prova antiga (PDF, Word, PowerPoint, texto ou foto). Prova anexada vira o perfil do que cai.</Text>}
        {!!p?.resumo?.perfil?.topicos?.length && (
          <View style={{ gap: 6 }}>
            <Text style={s.secao2}>O QUE CAI · PELAS PROVAS ANEXADAS</Text>
            {!!p.resumo.perfil.banca && <Text style={{ color: c.fg, fontSize: 13.5 }}>{[p.resumo.perfil.banca, p.resumo.perfil.formato].filter(Boolean).join(" · ")}</Text>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {p.resumo.perfil.topicos.map((t) => <Text key={t} style={{ color: c.muted, fontSize: 12.5, backgroundColor: c.raised, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>{t}</Text>)}
            </View>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Botao rotulo="Arquivo" icone={<Paperclip size={14} color={c.fg} />} onPress={anexar} flex />
          <Botao rotulo="Colar texto" icone={<Prancheta size={14} color={c.fg} />} onPress={() => setFolha("colar")} flex />
        </View>
      </Folha>
      <Folha aberta={folha === "colar"} titulo="Colar texto como material" onFecha={() => setFolha("material")}>
        <Area valor={colado} onMuda={setColado} placeholder="Cole aqui as anotações, o capítulo, a lista de exercícios…" linhas={8} />
        <Botao primario rotulo="Adicionar ao material" desabilitado={!colado.trim()} onPress={colar} />
      </Folha>
      <Folha aberta={folha === "prefs"} titulo="Como você quer o resumo" onFecha={() => setFolha(null)}>
        {([["Nível", "nivel", NIVEIS], ["Objetivo", "objetivo", OBJETIVOS], ["Tom", "tom", TONS], ["Tamanho", "tamanho", TAMANHOS]] as const).map(([rotulo, chave, opcoes]) => (
          <View key={chave} style={{ gap: 8 }}>
            <Text style={s.secao2}>{rotulo.toUpperCase()}</Text>
            <Seletor valor={aj.prefs[chave] as string} opcoes={[...opcoes]} onMuda={(v) => muda({ prefs: { ...aj.prefs, [chave]: v } })} />
          </View>
        ))}
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>EXTRAS</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {EXTRAS.map((x) => {
              const on = aj.prefs.extras.includes(x.id);
              return <Chip key={x.id} rotulo={x.rotulo} max={200} ativo={on} onPress={() => muda({ prefs: { ...aj.prefs, extras: on ? aj.prefs.extras.filter((e) => e !== x.id) : [...aj.prefs.extras, x.id] } })} />;
            })}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>OBSERVAÇÕES</Text>
          <Area valor={aj.prefs.observacoes} onMuda={(v) => muda({ prefs: { ...aj.prefs, observacoes: v } })} placeholder="Ex.: foque no que cai na segunda fase" linhas={2} />
        </View>
      </Folha>
      <Folha aberta={folha === "prof"} titulo="Pesquisa na web" onFecha={() => setFolha(null)}>
        <Lista opcoes={PROFUNDIDADES.map((x) => ({ id: x.id, rotulo: x.rotulo, dica: x.dica }))} valor={aj.prof} onEscolhe={(v) => { muda({ prof: v }); setFolha(null); }} />
      </Folha>
      <Folha aberta={folha === "sumario"} titulo="Sumário" onFecha={() => setFolha(null)}>
        <Lista opcoes={secoes.map((t, i) => ({ id: String(i), rotulo: t }))} valor="" onEscolhe={(v) => { setFolha(null); setTimeout(() => doc.current?.irPara(Number(v)), 250); }} />
      </Folha>
      <Folha aberta={folha === "modelos"} titulo="Modelos do estudo" onFecha={() => setFolha(null)}>
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>RESUMO E PROVA</Text>
          <Pressable onPress={() => setFolha("escritor")} style={{ height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
            <Cube size={15} color={c.muted} />
            <Text style={{ color: aj.escritor ? c.fg : c.faint, fontFamily: mono, fontSize: 13, flex: 1 }} numberOfLines={1}>{aj.escritor?.nome ?? "Escolher modelo"}</Text>
          </Pressable>
          <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>Escreve o resumo, as questões e corrige as discursivas. Vale o melhor modelo que você tiver.</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>LEITURA E CONFERÊNCIA</Text>
          <Seletor cheio valor={aj.extrator ? "escolher" : "auto"} opcoes={[{ id: "auto", rotulo: "Automática" }, { id: "escolher", rotulo: "Escolher" }]}
                   onMuda={(v) => (v === "auto" ? muda({ extrator: null }) : setFolha("extrator"))} />
          {aj.extrator && (
            <Pressable onPress={() => setFolha("extrator")} style={{ height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
              <Cube size={15} color={c.muted} />
              <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13, flex: 1 }} numberOfLines={1}>{aj.extrator.nome}</Text>
            </Pressable>
          )}
          <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>Tira notas do material grande, lê as páginas da web e confere o gabarito da prova. Um modelo diferente do de cima pega mais erro.</Text>
        </View>
        <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>O Claude via MCP, quando ligado no PC, aparece lá na tela Estudos; aqui vale o modelo escolhido.</Text>
      </Folha>
      <Modelos aberto={folha === "escritor"} soProvedor onFecha={() => setFolha("modelos")} onEscolhe={([e]) => { muda({ escritor: e }); setFolha("modelos"); }} />
      <Modelos aberto={folha === "extrator"} soProvedor onFecha={() => setFolha("modelos")} onEscolhe={([e]) => { muda({ extrator: e }); setFolha("modelos"); }} />
    </View>
  );
}
