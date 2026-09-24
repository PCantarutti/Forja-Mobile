import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, base, cancelado, comToken, lerAjustes, type Msg, salvaAjustes, streamSSE } from "./api";
import type { Conv } from "./Chat";
import { Busca, Cubo, Enviar, Globo, Parar } from "./icones";
import Markdown from "./Markdown";
import Modelos, { type Escolha } from "./Modelos";
import { useTeclado } from "./teclado";
import { c, s } from "./tema";
import { Campo, Chip, Contador, Folha, Opcao, Seletor } from "./ui";

// PesquisaEstado do desktop (types.ts, pesquisa.py).
type Fonte = { id: string; url: string; titulo: string; dominio: string; status: string; erro: string; resumo: string };
type Estado = { message_id: number; pergunta: string; status: string; fase: string; plano?: { perguntas: string[]; buscas: string[] };
                rodada: number; fontes: Fonte[]; resumo: string; aviso: string; relatorio: string; rodadas_total?: number;
                stats?: { fontes: number; uteis: number; segundos: number; tokens: number } };
type Ajustes = { prof: string; minutos: number; rodadas: number; formato: string; escritor: Escolha | null; extrator: Escolha | null; perguntar: boolean };

// Presets do desktop (PesquisaView): tempo e rodadas de cada profundidade.
const PROFUNDIDADE = [
  { id: "rapida", rotulo: "Rápida", min: 5, rodadas: 1 }, { id: "normal", rotulo: "Normal", min: 10, rodadas: 2 },
  { id: "funda", rotulo: "Funda", min: 30, rodadas: 4 }, { id: "personalizado", rotulo: "Personalizado", min: 10, rodadas: 2 },
];
const FORMATOS = [
  { id: "auto", rotulo: "Auto" }, { id: "produto", rotulo: "Produto" }, { id: "comparar", rotulo: "Comparar" },
  { id: "guia", rotulo: "Guia" }, { id: "checagem", rotulo: "Checagem" },
];
const FASE: Record<string, string> = { planejando: "Planejando as buscas", buscando: "Buscando na web", lendo: "Lendo as fontes",
  escrevendo: "Escrevendo o relatório", pronto: "Pronto" };
const COR_FONTE: Record<string, string> = { util: c.green, lendo: c.sky, fila: c.faint, vazia: c.faint, erro: c.red };

/** Pesquisa profunda: busca, lê fontes e escreve um relatório. O HTML completo abre no navegador do celular. */
export default function Pesquisa({ conv, onCriada, onAbre, onTurno }:
  { conv: Conv | null; onCriada: (c: Conv) => void; onAbre: (id: number) => void; onTurno: () => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [pergunta, setPergunta] = useState("");
  const [aj, setAj] = useState<Ajustes>({ prof: "normal", minutos: 10, rodadas: 2, formato: "auto", escritor: null, extrator: null, perguntar: false });
  const [folha, setFolha] = useState<null | "ajustes" | "escritor" | "extrator">(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [perguntas, setPerguntas] = useState<{ texto: string; qs: string[]; resp: string[] } | null>(null);
  const [pensando, setPensando] = useState(false);
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
    if (convId == null) return;
    api.get<{ messages: Msg[] }>(`/conversations/${convId}`).then(({ messages }) => {
      const m = [...messages].reverse().find((x) => x.meta?.pesquisa);
      // O stream devolve o estado mesmo de pesquisa já terminada (pesquisa.estado lê do banco) e encerra.
      if (m) segue(`/pesquisa/${m.id}/stream`).catch(() => {});
    }).catch((e) => setErro(e.message));
    return () => abort.current?.abort();
  }, [convId]);

  const rodando = estado?.status === "rodando";
  const rodava = useRef(false);
  useEffect(() => { if (rodava.current && !rodando) onTurno(); rodava.current = rodando; }, [rodando]); // título pode ter mudado

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

  const uteis = estado?.fontes.filter((f) => f.status === "util").length ?? 0;
  const prof = PROFUNDIDADE.find((p) => p.id === aj.prof) ?? PROFUNDIDADE[1];

  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {perguntas ? (
          <View style={{ gap: 12 }}>
            <Text style={[s.txt, { fontWeight: "600" }]}>Antes de pesquisar</Text>
            <Text style={s.muted}>{perguntas.texto}</Text>
            {perguntas.qs.map((q, i) => (
              <Campo key={i} rotulo={q}>
                <TextInput style={s.input} value={perguntas.resp[i]} placeholderTextColor={c.faint} placeholder="Sua resposta (opcional)"
                           onChangeText={(t) => setPerguntas((p) => p && { ...p, resp: p.resp.map((x, j) => (j === i ? t : x)) })} />
              </Campo>
            ))}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={s.btn} onPress={() => roda(perguntas.texto, perguntas.qs.map((q, i) => (perguntas.resp[i].trim() ? `${q} ${perguntas.resp[i].trim()}` : "")).filter(Boolean).join("\n"))}>
                <Text style={s.btnTxt}>Pesquisar</Text>
              </Pressable>
              <Pressable style={s.btnSec} onPress={() => roda(perguntas.texto)}><Text style={s.btnSecTxt}>Pular</Text></Pressable>
            </View>
          </View>
        ) : !estado ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
            <Busca size={36} color={c.muted} />
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600" }}>Pesquisa profunda</Text>
            <Text style={[s.muted, { textAlign: "center" }]}>Faça uma pergunta: o Forja busca na web, lê as fontes e escreve um relatório citando cada uma.</Text>
          </View>
        ) : (
          <>
            <Text style={[s.txt, { fontSize: 17, fontWeight: "600" }]}>{estado.pergunta}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface, borderColor: c.line, borderWidth: 1,
                           borderRadius: 14, padding: 12 }}>
              {rodando ? <ActivityIndicator size="small" color={c.muted} /> : <View style={{ width: 8, height: 8, borderRadius: 4,
                backgroundColor: estado.status === "pronto" ? c.green : c.red }} />}
              <View style={{ flex: 1 }}>
                <Text style={s.txt}>{rodando ? FASE[estado.fase] ?? estado.fase : estado.status === "pronto" ? "Relatório pronto" : estado.status}</Text>
                <Text style={s.faint}>
                  {estado.fontes.length} fontes · {uteis} úteis{estado.rodada ? ` · rodada ${estado.rodada}${estado.rodadas_total ? `/${estado.rodadas_total}` : ""}` : ""}
                  {estado.stats?.segundos ? ` · ${Math.round(estado.stats.segundos)}s` : ""}
                </Text>
              </View>
            </View>
            {!!estado.aviso && <Text style={{ color: c.amber, fontSize: 13 }}>{estado.aviso}</Text>}
            {!!estado.plano?.buscas?.length && rodando && (
              <View style={{ gap: 4 }}>
                <Text style={s.secao}>Buscas</Text>
                {estado.plano.buscas.map((b) => <Text key={b} style={s.muted}>• {b}</Text>)}
              </View>
            )}
            {!!estado.fontes.length && (
              <View style={{ gap: 2 }}>
                <Text style={s.secao}>Fontes</Text>
                {estado.fontes.map((f) => (
                  <Pressable key={f.id} onPress={() => setAberta(aberta === f.id ? null : f.id)} style={{ paddingVertical: 7, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: COR_FONTE[f.status] ?? c.faint }} />
                      <Text style={[s.txt, { flex: 1, fontSize: 14 }]} numberOfLines={1}>{f.titulo || f.url}</Text>
                      <Text style={[s.faint, { fontSize: 11 }]}>{f.dominio}</Text>
                    </View>
                    {aberta === f.id && (
                      <View style={{ paddingLeft: 15, gap: 4 }}>
                        {!!(f.resumo || f.erro) && <Text style={[s.muted, { fontSize: 13 }]}>{f.resumo || f.erro}</Text>}
                        <Text style={{ color: c.link, fontSize: 12 }} onPress={() => Linking.openURL(f.url)}>{f.url}</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
            {!!estado.relatorio && <Markdown texto={estado.relatorio} />}
            {!rodando && estado.status === "pronto" && (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pressable style={[s.btn, { flexDirection: "row", gap: 6 }]}
                           onPress={() => Linking.openURL(comToken(`${base()}/api/pesquisa/${estado.message_id}/relatorio`))}>
                  <Globo size={15} color="#000" /><Text style={s.btnTxt}>Relatório completo</Text>
                </Pressable>
                <Pressable style={s.btnSec} onPress={discutir}><Text style={s.btnSecTxt}>Discutir no chat</Text></Pressable>
                {/* Continuar: o backend pula as URLs já lidas e reescreve o relatório com o que achar a mais. */}
                <Pressable style={s.btnSec} onPress={() => roda(estado.pergunta, "", estado.message_id)}><Text style={s.btnSecTxt}>Continuar pesquisa</Text></Pressable>
              </View>
            )}
          </>
        )}
        {!!erro && <Text style={[s.muted, { color: c.red }]} onPress={() => setErro("")}>{erro}</Text>}
      </ScrollView>
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={pergunta}
                     onChangeText={setPergunta} multiline placeholder="O que você quer pesquisar?" placeholderTextColor={c.faint} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={`${prof.rotulo} · ${aj.minutos} min`} onPress={() => setFolha("ajustes")} />
              <Chip rotulo={FORMATOS.find((f) => f.id === aj.formato)?.rotulo ?? "Auto"} onPress={() => setFolha("ajustes")} />
              <Chip rotulo={aj.escritor?.nome ?? "Modelo"} icone={<Cubo size={13} color={c.muted} />} onPress={() => setFolha("ajustes")} max={170} />
              {aj.perguntar && <Chip rotulo="Perguntar antes" ativo onPress={() => muda({ perguntar: false })} />}
            </ScrollView>
            {rodando ? (
              <Pressable onPress={() => estado && api.post(`/pesquisa/${estado.message_id}/cancelar`).catch((e) => setErro(e.message))} style={redondo}>
                <Parar size={16} color="#000" />
              </Pressable>
            ) : pensando ? <ActivityIndicator color={c.muted} /> : (
              <Pressable onPress={comeca} disabled={!pergunta.trim() || !aj.escritor} style={[redondo, { opacity: pergunta.trim() && aj.escritor ? 1 : 0.35 }]}>
                <Enviar size={18} color="#000" />
              </Pressable>
            )}
          </View>
        </View>
      </View>
      <Folha aberta={folha === "ajustes"} titulo="Ajustes da pesquisa" onFecha={() => setFolha(null)}>
        <Campo rotulo="Profundidade">
          <Seletor opcoes={PROFUNDIDADE} valor={aj.prof}
                   onMuda={(v) => { const p = PROFUNDIDADE.find((x) => x.id === v)!; muda(v === "personalizado" ? { prof: v } : { prof: v, minutos: p.min, rodadas: p.rodadas }); }} />
        </Campo>
        <Campo rotulo="Tempo máximo"><Contador valor={aj.minutos} min={1} max={120} sufixo="min" onMuda={(n) => muda({ minutos: n })} /></Campo>
        {aj.prof === "personalizado" && (
          <Campo rotulo="Rodadas de busca"><Contador valor={aj.rodadas} min={1} max={8} onMuda={(n) => muda({ rodadas: n })} /></Campo>
        )}
        <Campo rotulo="Formato do relatório">
          <Seletor opcoes={FORMATOS} valor={aj.formato} onMuda={(v) => muda({ formato: v })} />
        </Campo>
        <Campo rotulo="Modelo do relatório">
          <Chip rotulo={aj.escritor?.nome ?? "Escolher"} icone={<Cubo size={13} color={c.muted} />} onPress={() => setFolha("escritor")} max={260} />
        </Campo>
        <Campo rotulo="Modelo da extração" dica="Automática usa o slot rápido dos subagentes (ou o próprio modelo do relatório).">
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Chip rotulo="Automática" ativo={!aj.extrator} onPress={() => muda({ extrator: null })} />
            <Chip rotulo={aj.extrator?.nome ?? "Escolher"} ativo={!!aj.extrator} onPress={() => setFolha("extrator")} max={220} />
          </View>
        </Campo>
        <Opcao rotulo="Perguntar antes" dica="O modelo faz até 3 perguntas para afinar a pesquisa antes de começar."
               valor={aj.perguntar} onMuda={(v) => muda({ perguntar: v })} />
      </Folha>
      {/* Pesquisa usa provedor+modelo (o backend não aceita .gguf avulso aqui). */}
      <Modelos aberto={folha === "escritor"} soProvedor onFecha={() => setFolha("ajustes")} onEscolhe={([e]) => { muda({ escritor: e }); setFolha("ajustes"); }} />
      <Modelos aberto={folha === "extrator"} soProvedor onFecha={() => setFolha("ajustes")} onEscolhe={([e]) => { muda({ extrator: e }); setFolha("ajustes"); }} />
    </View>
  );
}

const redondo = { width: 36, height: 36, borderRadius: 18, backgroundColor: c.fg, alignItems: "center" as const, justifyContent: "center" as const };
