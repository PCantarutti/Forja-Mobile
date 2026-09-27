import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { Text, TextInput } from "./Texto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, base, cancelado, comToken, lerAjustes, type Msg, salvaAjustes, streamSSE } from "./api";
import type { Conv } from "./Chat";
import { compartilhaTexto } from "./Comparar";
import { ArrowRight, Balao, Busca, Check, Clock, Copy, Cube, Download, ExternalLink, Gauge, Prancheta, Refresh, X } from "./icones";
import { BotaoEnviar } from "./Imagens";
import Markdown from "./Markdown";
import Modelos, { type Escolha } from "./Modelos";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Botao, Campo, Chip, Contador, Folha, Gira, Lista, Pulsa, Seletor, toast } from "./ui";

// PesquisaEstado do desktop (types.ts, pesquisa.py).
type Fonte = { id: string; url: string; titulo: string; dominio: string; status: string; erro: string; resumo: string; trecho?: string };
type Estado = { message_id: number; pergunta: string; status: string; fase: string; plano?: { perguntas: string[]; buscas: string[] };
                rodada: number; rodadas?: { n: number; buscas: string[] }[]; fontes: Fonte[]; resumo: string; aviso: string; relatorio: string;
                rodadas_total?: number; formato?: string; formato_usado?: string;
                stats?: { fontes: number; uteis: number; segundos: number; tokens: number; gerando?: number; estimado?: boolean; extrator?: string; escritor?: string } };
type Ajustes = { prof: string; minutos: number; rodadas: number; formato: string; escritor: Escolha | null; extrator: Escolha | null; perguntar: boolean };

// Presets do desktop (PesquisaView): tempo e rodadas de cada profundidade.
const PROFUNDIDADE = [
  { id: "rapida", rotulo: "Rápida", min: 5, rodadas: 1, dica: "1 rodada, 3 páginas, relatório de ~800 palavras — cabe num modelo local pequeno" },
  { id: "normal", rotulo: "Normal", min: 10, rodadas: 2, dica: "2 rodadas, 5 páginas por rodada, relatório de ~1200 palavras" },
  { id: "funda", rotulo: "Funda", min: 30, rodadas: 4,
    dica: "4 rodadas, 8 páginas por rodada, relatório de 1800 a 3000 palavras com subseções; o relatório é refeito a cada rodada. Peça a um modelo grande." },
  { id: "personalizado", rotulo: "Personalizado", min: 10, rodadas: 2, dica: "Você escolhe rodadas e tempo; leitura e relatório no tamanho da Funda" },
];
const FORMATOS = [
  { id: "auto", rotulo: "Auto", dica: "O modelo decide o feitio do relatório pela pergunta" },
  { id: "produto", rotulo: "Produto", dica: "Lista ordenada com preço, prós, contras e veredito" },
  { id: "comparar", rotulo: "Comparar", dica: "Tabela comparativa e uma seção por opção" },
  { id: "guia", rotulo: "Guia", dica: "Resumo rápido, pré-requisitos e passo a passo" },
  { id: "checagem", rotulo: "Checagem", dica: "A afirmação, evidências dos dois lados e veredito" },
];
const FASES = [{ id: "planejando", rotulo: "Planejar" }, { id: "buscando", rotulo: "Buscar" }, { id: "lendo", rotulo: "Ler fontes" }, { id: "escrevendo", rotulo: "Escrever" }];
const FONTE: Record<string, [string, string]> = { util: ["útil", c.ok], vazia: ["nada aproveitável", c.faint], erro: ["erro", c.err],
  lendo: ["lendo…", c.info], fila: ["na fila", c.faint] };
const relogio = (seg: number) => `${Math.floor(seg / 60)}:${String(Math.floor(seg % 60)).padStart(2, "0")}`;
/** "1.234 tokens · 38 tok/s · 3:12" — o que dá para dizer com o que o provedor devolveu (numeros() do desktop). */
function numeros(e: Estado): string {
  const st = e.stats;
  if (!st) return "";
  const tps = (st.gerando ?? 0) > 0.5 ? Math.round(st.tokens / st.gerando!) : 0;
  return [st.tokens ? `${st.tokens.toLocaleString("pt-BR")} tokens${st.estimado ? " (estim.)" : ""}` : "", tps ? `${tps} tok/s` : "", relogio(st.segundos)]
    .filter(Boolean).join(" · ");
}
const comoMarkdown = (e: Estado) => [`# ${e.pergunta}`, "", e.relatorio || e.resumo || e.aviso, "", "## Fontes", "",
  ...e.fontes.filter((f) => f.status === "util").map((f) => `- [${f.titulo}](${f.url})`), ""].join("\n");

/** Pesquisa profunda (PesquisaView do desktop): busca, lê fontes e escreve um relatório. O HTML completo abre no navegador. */
export default function Pesquisa({ conv, onCriada, onAbre, onTurno }:
  { conv: Conv | null; onCriada: (c: Conv) => void; onAbre: (id: number) => void; onTurno: () => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [pergunta, setPergunta] = useState("");
  const [aj, setAj] = useState<Ajustes>({ prof: "normal", minutos: 10, rodadas: 2, formato: "auto", escritor: null, extrator: null, perguntar: false });
  const [folha, setFolha] = useState<null | "prof" | "tempo" | "rodadas" | "formato" | "modelos" | "escritor" | "extrator">(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [plano, setPlano] = useState(false);
  const [fimVisto, setFimVisto] = useState<number | null>(null);
  const [perguntas, setPerguntas] = useState<{ texto: string; qs: string[]; resp: string[] } | null>(null);
  const [pensando, setPensando] = useState(false);
  const [cota, setCota] = useState<number | null>(null); // maior uso de cota entre os provedores de nuvem
  const [erro, setErro] = useState("");
  const abort = useRef<AbortController | null>(null);
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const muda = (x: Partial<Ajustes>) => setAj((a) => { const n = { ...a, ...x }; salvaAjustes("pesquisa", n); return n; });

  const segue = useCallback((path: string, body?: unknown) => {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    return streamSSE(path, (ev) => (ev.erro ? setErro(ev.erro) : setEstado(ev)), ac.signal, body);
  }, []);

  useEffect(() => {
    // Redator padrão: o modelo do chat (ajustes do app) ou o do último turno no desktop.
    Promise.all([lerAjustes<Ajustes>("pesquisa", aj), lerAjustes<{ provider: string; model: string }>("modelo", { provider: "", model: "" }),
      api.get<{ defaults: Record<string, string> }>("/mobile").catch(() => ({ defaults: {} as Record<string, string> }))])
      .then(([salvo, m, { defaults: d }]) => {
        const p = m.model ? m : d;
        setAj({ ...salvo, escritor: salvo.escritor ?? (p.model ? { provider: p.provider, model: p.model, nome: p.model } : null) });
      });
    api.get<{ providers: { limits: { usage: number }[] }[] }>("/cloud-usage")
      .then((r) => { const us = r.providers.flatMap((p) => p.limits.map((l) => l.usage)); if (us.length) setCota(Math.max(...us)); }).catch(() => {});
    if (convId == null) return;
    api.get<{ messages: Msg[] }>(`/conversations/${convId}`).then(({ messages }) => {
      const m = [...messages].reverse().find((x) => x.meta?.pesquisa);
      // O stream devolve o estado mesmo de pesquisa já terminada (pesquisa.estado lê do banco) e encerra.
      if (m) { setFimVisto(m.id); segue(`/pesquisa/${m.id}/stream`).catch(() => {}); }
    }).catch((e) => setErro(e.message));
    return () => abort.current?.abort();
  }, [convId]);

  const rodando = estado?.status === "rodando";
  const rodava = useRef(false);
  useEffect(() => {
    if (rodava.current && !rodando) { onTurno(); setFimVisto(null); } // título pode ter mudado; a faixa de concluída aparece
    rodava.current = rodando;
  }, [rodando]);

  async function roda(texto: string, contexto = "", continuarDe?: number) {
    if (!texto || !aj.escritor?.model) return;
    setErro("");
    try {
      let id = convId;
      if (id == null) {
        const nova = await api.post<Conv>("/conversations", { kind: "pesquisa" });
        id = nova.id;
        onCriada(nova);
        setConvId(id);
      }
      setPergunta("");
      setPerguntas(null);
      await segue(`/pesquisa/${id}/rodar`, {
        pergunta: texto, profundidade: aj.prof, formato: aj.formato, contexto, continuar_de: continuarDe,
        provider: aj.escritor.provider, model: aj.escritor.model,
        // Extração vazia = automática (o slot rápido dos subagentes, ou o próprio redator).
        ex_provider: aj.extrator?.provider ?? "", ex_model: aj.extrator?.model ?? "",
        teto: aj.minutos * 60, rodadas: aj.prof === "personalizado" ? aj.rodadas : undefined,
      });
    } catch (e: any) {
      if (!cancelado(e)) { setErro(e.message); setPergunta((p) => p || texto); } // falhou: a pergunta volta
    }
  }

  /** "Perguntar antes": o modelo devolve até 3 perguntas para afinar; sem perguntas, a pesquisa já começa. */
  async function comeca() {
    const texto = pergunta.trim();
    if (!texto || !aj.escritor?.model) return;
    if (!aj.perguntar) return roda(texto);
    setErro(""); // o erro da tentativa anterior ficava embaixo das perguntas novas
    setPensando(true);
    try {
      const r = await api.post<{ perguntas: string[] }>("/pesquisa/perguntas", { pergunta: texto, provider: aj.escritor.provider, model: aj.escritor.model }, 180000);
      if (!r.perguntas.length) roda(texto);
      else setPerguntas({ texto, qs: r.perguntas, resp: r.perguntas.map(() => "") });
    } catch (e: any) { setErro(e.message); }
    setPensando(false);
  }

  async function discutir() {
    if (!estado) return;
    try { onAbre((await api.post<{ conversation_id: number }>(`/pesquisa/${estado.message_id}/discutir`)).conversation_id); }
    catch (e: any) { setErro(e.message); }
  }

  const prof = PROFUNDIDADE.find((p) => p.id === aj.prof) ?? PROFUNDIDADE[1];
  const formato = FORMATOS.find((f) => f.id === aj.formato) ?? FORMATOS[0];
  const faseI = estado ? (estado.status === "pronto" ? FASES.length : FASES.findIndex((f) => f.id === estado.fase)) : -1;
  const uteis = estado?.fontes.filter((f) => f.status === "util").length ?? 0;
  const mostraFim = estado && !rodando && fimVisto !== estado.message_id && ["pronto", "cancelado", "erro"].includes(estado.status);

  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {!estado ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
            <Busca size={32} color={c.muted} />
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600" }}>Pesquisa profunda</Text>
            <Text style={[s.muted, { textAlign: "center", lineHeight: 19 }]}>Faça uma pergunta: o Forja busca na web, lê as fontes e escreve um relatório citando cada uma.</Text>
          </View>
        ) : (
          <>
            <View style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {FASES.map((f, i) => {
                  const cor = i < faseI ? c.muted : i === faseI ? c.info : c.faint;
                  return (
                    <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      {i < faseI ? <Check size={12} color={cor} /> : i === faseI && rodando ? <ArrowRight size={12} color={cor} /> : null}
                      <Text style={{ color: cor, fontSize: 12.5 }}>{f.rotulo}</Text>
                      {i < FASES.length - 1 && <Text style={{ color: c.faint, fontSize: 12.5 }}> ·</Text>}
                    </View>
                  );
                })}
              </View>
              <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>
                {[estado.rodada ? `rodada ${estado.rodada}` : "", `${uteis} úteis de ${estado.fontes.length}`, numeros(estado)].filter(Boolean).join(" · ")}
              </Text>
              <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 21 }}>{estado.pergunta}</Text>
              {!!estado.plano?.perguntas?.length && (
                <>
                  <Pressable onPress={() => setPlano(!plano)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.secao2}>PLANO DA PESQUISA</Text>
                    <Gira aberto={plano} size={12} />
                  </Pressable>
                  {plano && (
                    <View style={{ gap: 6 }}>
                      {estado.plano.perguntas.map((q, i) => <Text key={i} style={{ color: c.fg2, fontSize: 13, lineHeight: 19 }}>· {q}</Text>)}
                      {(estado.rodadas ?? []).map((r) => (
                        <Text key={r.n} style={{ color: c.faint, fontSize: 12.5, lineHeight: 18 }}>Rodada {r.n}: {r.buscas.join(" · ")}</Text>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>

            {mostraFim && (
              estado.status === "pronto" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(95,211,154,0.5)",
                               backgroundColor: c.okSoft, paddingVertical: 9, paddingHorizontal: 12 }}>
                  <Check size={15} color={c.ok} />
                  <Text style={{ color: c.fg2, fontSize: 13, flex: 1 }}>Pesquisa concluída · {estado.stats?.uteis ?? uteis} fontes úteis · {relogio(estado.stats?.segundos ?? 0)}</Text>
                  <Pressable hitSlop={10} onPress={() => setFimVisto(estado.message_id)}><X size={14} color={c.faint} /></Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(242,161,74,0.5)",
                               backgroundColor: c.warnSoft, paddingVertical: 9, paddingHorizontal: 12 }}>
                  <Text style={{ color: c.warn, fontSize: 13, flex: 1 }}>Pesquisa {estado.status === "erro" ? "com erro" : "cancelada"}{estado.aviso ? ` · ${estado.aviso}` : ""}</Text>
                  <Pressable hitSlop={10} onPress={() => setFimVisto(estado.message_id)}><X size={14} color={c.faint} /></Pressable>
                </View>
              )
            )}
            {!!estado.aviso && estado.status === "rodando" && <Text style={{ color: c.warn, fontSize: 13 }}>{estado.aviso}</Text>}

            {!!estado.resumo && (
              <View style={{ borderRadius: 14, borderWidth: 3, borderColor: c.accentSoft }}>
                <View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.accentLine, backgroundColor: c.surface, padding: 12, gap: 6 }}>
                  <Text style={[s.secao2, { color: c.accentText }]}>RESUMO</Text>
                  <Markdown texto={estado.resumo} />
                </View>
              </View>
            )}
            {!!estado.relatorio && <Markdown texto={estado.relatorio} />}
            {rodando && !estado.relatorio && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color={c.faint} />
                <Text style={s.faint}>{FASES.find((f) => f.id === estado.fase)?.rotulo ?? estado.fase}…</Text>
              </View>
            )}

            {!rodando && estado.status === "pronto" && (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Botao primario altura={40} rotulo="Abrir relatório" icone={<ExternalLink size={14} color={c.accentFg} />} estilo={{ borderRadius: 12 }}
                         onPress={() => Linking.openURL(comToken(`${base()}/api/pesquisa/${estado.message_id}/relatorio`))} />
                  {/* Continuar: o backend pula as URLs já lidas e reescreve o relatório com o que achar a mais. */}
                  <Botao altura={40} rotulo="Continuar pesquisa" icone={<ArrowRight size={14} color={c.fg} />} estilo={{ borderRadius: 12 }}
                         onPress={() => roda(estado.pergunta, "", estado.message_id)} />
                  <Botao altura={40} rotulo="Discutir no chat" icone={<Balao size={14} color={c.fg} />} estilo={{ borderRadius: 12 }} onPress={discutir} />
                  <Botao altura={40} rotulo="Copiar .md" icone={<Copy size={14} color={c.fg} />} estilo={{ borderRadius: 12 }}
                         onPress={() => Clipboard.setStringAsync(comoMarkdown(estado)).then(() => toast("Relatório copiado."))} />
                  <Botao altura={40} rotulo="Baixar .md" icone={<Download size={14} color={c.fg} />} estilo={{ borderRadius: 12 }}
                         onPress={() => compartilhaTexto(`pesquisa-${estado.message_id}.md`, comoMarkdown(estado)).catch((e) => setErro(e.message))} />
                </View>
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
                  {[estado.stats?.extrator && `extração: ${estado.stats.extrator}`, estado.stats?.escritor && `relatório: ${estado.stats.escritor}`,
                    `formato: ${estado.formato_usado || estado.formato || aj.formato}`, numeros(estado)].filter(Boolean).join(" · ")}
                </Text>
              </View>
            )}

            {!!estado.fontes.length && (
              <View style={{ gap: 8 }}>
                <Text style={s.secao2}>FONTES · {estado.fontes.length}</Text>
                <View style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
                  {estado.fontes.map((f, i) => {
                    const [rot, cor] = FONTE[f.status] ?? [f.status, c.faint];
                    return (
                      <View key={f.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.line, padding: 12, gap: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <Pressable style={{ flex: 1, gap: 2 }} onPress={() => setAberta(aberta === f.id ? null : f.id)}>
                            <Text style={{ color: c.fg, fontSize: 13.5 }} numberOfLines={2}>{f.titulo || f.url}</Text>
                            <Text style={{ fontSize: 11.5 }} numberOfLines={1}>
                              <Text style={{ color: c.faint, fontFamily: mono }}>{f.dominio}</Text>
                              <Text style={{ color: cor }}> · {f.erro && f.status === "erro" ? `erro: ${f.erro}` : rot}</Text>
                            </Text>
                          </Pressable>
                          {f.status === "lendo" && <Pulsa cor={c.info} lado={6} />}
                          <Pressable hitSlop={10} onPress={() => Linking.openURL(f.url)}><ExternalLink size={15} color={c.muted} /></Pressable>
                        </View>
                        {aberta === f.id && (
                          <View style={{ gap: 4 }}>
                            {!!f.resumo && <Text style={{ color: c.fg2, fontSize: 13, lineHeight: 19 }}>{f.resumo}</Text>}
                            {!!f.trecho && <Text style={{ color: c.faint, fontSize: 12.5, fontStyle: "italic", lineHeight: 18 }}>“{f.trecho}”</Text>}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        )}
        {!!erro && <Text style={[s.muted, { color: c.err }]} onPress={() => setErro("")}>{erro}</Text>}
      </ScrollView>

      {perguntas && (
        <View style={{ marginHorizontal: 12, marginBottom: 6, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 10 }}>
          <Text style={{ color: c.fg, fontSize: 13.5, fontWeight: "600" }}>Antes de buscar, para focar a pesquisa:</Text>
          {perguntas.qs.map((q, i) => (
            <Campo key={i} rotulo={q}>
              <TextInput style={s.input} value={perguntas.resp[i]} placeholderTextColor={c.faint} placeholder="Sua resposta (opcional)"
                         onChangeText={(t) => setPerguntas((p) => p && { ...p, resp: p.resp.map((x, j) => (j === i ? t : x)) })} />
            </Campo>
          ))}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao primario rotulo="Pesquisar" onPress={() => roda(perguntas.texto,
              perguntas.qs.map((q, i) => (perguntas.resp[i].trim() ? `${q} ${perguntas.resp[i].trim()}` : "")).filter(Boolean).join("\n"))} />
            <Botao rotulo="Pular" onPress={() => roda(perguntas.texto)} />
          </View>
        </View>
      )}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={pergunta}
                     onChangeText={setPergunta} multiline placeholder="O que você quer descobrir?" placeholderTextColor={c.faint} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={prof.rotulo} icone={<Busca size={14} color={c.muted} />} onPress={() => setFolha("prof")} />
              <Chip rotulo={`${aj.minutos} min`} icone={<Clock size={14} color={c.muted} />} onPress={() => setFolha("tempo")} />
              {aj.prof === "personalizado" && (
                <Chip rotulo={`${aj.rodadas} rodada${aj.rodadas === 1 ? "" : "s"}`} icone={<Refresh size={14} color={c.muted} />} onPress={() => setFolha("rodadas")} />
              )}
              <Chip rotulo={formato.rotulo} icone={<Prancheta size={14} color={c.muted} />} onPress={() => setFolha("formato")} />
              <Chip rotulo="Perguntar antes" ativo={aj.perguntar} icone={<Check size={14} color={aj.perguntar ? c.accentText : c.muted} />}
                    onPress={() => muda({ perguntar: !aj.perguntar })} />
              <Chip rotulo="Modelos" icone={<Cube size={14} color={c.muted} />} onPress={() => setFolha("modelos")} />
              {cota != null && (
                <Chip rotulo={`${Math.round(cota * 100)}%`} icone={<Gauge size={14} color={cota >= 0.9 ? c.err : cota >= 0.7 ? c.warn : c.muted} />}
                      cor={cota >= 0.9 ? c.err : cota >= 0.7 ? c.warn : undefined} onPress={() => toast("Cota da nuvem usada na janela atual.")} />
              )}
            </ScrollView>
            {rodando ? (
              <Pressable onPress={() => estado && api.post(`/pesquisa/${estado.message_id}/cancelar`).catch((e) => setErro(e.message))}
                         style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: c.accentFg }} />
              </Pressable>
            ) : pensando ? <ActivityIndicator color={c.muted} /> : <BotaoEnviar pode={!!pergunta.trim() && !!aj.escritor} onPress={comeca} />}
          </View>
        </View>
      </View>

      <Folha aberta={folha === "prof"} titulo="Profundidade" onFecha={() => setFolha(null)}>
        <Lista opcoes={PROFUNDIDADE.map((p) => ({ id: p.id, rotulo: p.rotulo, dica: p.dica }))} valor={aj.prof}
               onEscolhe={(v) => { const p = PROFUNDIDADE.find((x) => x.id === v)!; setFolha(null); muda(v === "personalizado" ? { prof: v } : { prof: v, minutos: p.min, rodadas: p.rodadas }); }} />
      </Folha>
      <Folha aberta={folha === "tempo"} titulo="Tempo máximo" onFecha={() => setFolha(null)}>
        <View style={{ alignItems: "center" }}><Contador valor={aj.minutos} min={1} max={120} sufixo=" min" onMuda={(n) => muda({ minutos: n })} /></View>
        <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>Entre 1 e 120 min. Passou do tempo, ela escreve o relatório com o que já leu.</Text>
      </Folha>
      <Folha aberta={folha === "rodadas"} titulo="Rodadas de busca" onFecha={() => setFolha(null)}>
        <View style={{ alignItems: "center" }}><Contador valor={aj.rodadas} min={1} max={8} onMuda={(n) => muda({ rodadas: n })} /></View>
      </Folha>
      <Folha aberta={folha === "formato"} titulo="Formato do relatório" onFecha={() => setFolha(null)}>
        <Lista opcoes={FORMATOS} valor={aj.formato} onEscolhe={(v) => { setFolha(null); muda({ formato: v }); }} />
      </Folha>
      <Folha aberta={folha === "modelos"} titulo="Modelos da pesquisa" onFecha={() => setFolha(null)}>
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>RELATÓRIO</Text>
          <Pressable onPress={() => setFolha("escritor")} style={{ height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface,
                                                                    flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
            <Cube size={15} color={c.muted} />
            <Text style={{ color: aj.escritor ? c.fg : c.faint, fontFamily: mono, fontSize: 13, flex: 1 }} numberOfLines={1}>{aj.escritor?.nome ?? "Escolher modelo"}</Text>
          </Pressable>
          <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>Planeja as buscas e escreve o relatório: vale um modelo grande.</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>EXTRAÇÃO</Text>
          <Seletor cheio valor={aj.extrator ? "escolher" : "auto"} opcoes={[{ id: "auto", rotulo: "Automática" }, { id: "escolher", rotulo: "Escolher" }]}
                   onMuda={(v) => (v === "auto" ? muda({ extrator: null }) : setFolha("extrator"))} />
          {aj.extrator && (
            <Pressable onPress={() => setFolha("extrator")} style={{ height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface,
                                                                      flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
              <Cube size={15} color={c.muted} />
              <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13, flex: 1 }} numberOfLines={1}>{aj.extrator.nome}</Text>
            </Pressable>
          )}
          <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>Lê cada página e tira o que importa. Automática usa o slot rápido dos subagentes (ou o próprio modelo do relatório).</Text>
        </View>
      </Folha>
      {/* Pesquisa usa provedor+modelo (o backend não aceita .gguf avulso aqui). */}
      <Modelos aberto={folha === "escritor"} soProvedor onFecha={() => setFolha("modelos")} onEscolhe={([e]) => { muda({ escritor: e }); setFolha("modelos"); }} />
      <Modelos aberto={folha === "extrator"} soProvedor onFecha={() => setFolha("modelos")} onEscolhe={([e]) => { muda({ extrator: e }); setFolha("modelos"); }} />
    </View>
  );
}
