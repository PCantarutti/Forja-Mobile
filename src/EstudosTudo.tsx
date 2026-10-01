import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Text, TextInput } from "./Texto";
import { api, cancelado, enviaArquivo, streamSSE } from "./api";
import { pergunta } from "./Dialogo";
import { TextoRico } from "./Formula";
import { ArrowRight, Check, Paperclip, Trash } from "./icones";
import { c, mono, s } from "./tema";
import { Area, Botao, Contador, Folha, LinhaAjuste, toast } from "./ui";
import { type Casca, type EstudosEdital, type EstudosEditalItem, type EstudosMateria, type EstudosVisao, numeros } from "./estudosTipos";

const cartao = () => ({ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 });
/** O ponto de cada matéria: verde ≥ 70% de acerto, âmbar 50–69%, vermelho abaixo; cinza sem entrega. */
export const corAcerto = (a: number | null | undefined) => (a == null ? c.faint : a >= 70 ? c.ok : a >= 50 ? c.warn : c.err);
const pct = (a: number | null) => (a == null ? "—" : `${a}%`);

/** A visão do objetivo: lida uma vez e de novo quando o PC (ou o Claude) mexe no estudo. */
function useVisao(casca: Casca) {
  const [v, setV] = useState<EstudosVisao | null>(null);
  const ler = useCallback(() => {
    if (casca.conv == null) return;
    api.get<EstudosVisao>(`/estudos/${casca.conv}/visao`).then(setV).catch((e) => casca.erro(e.message));
  }, [casca.conv]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(ler, [ler, casca.carimbo]);
  return v;
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={{ flex: 1, minWidth: "45%", backgroundColor: c.raised, borderRadius: 12, padding: 10 }}>
      <Text style={{ color: c.faint, fontSize: 11.5 }}>{rotulo}</Text>
      <Text style={{ color: c.fg, fontFamily: mono, fontSize: 19, fontWeight: "600" }}>{valor}</Text>
    </View>
  );
}

export function VisaoGeral({ casca, onAbrir, onSimuladoFracos }: { casca: Casca; onAbrir: (m: string) => void; onSimuladoFracos: () => void }) {
  const v = useVisao(casca);
  if (!v) return <ActivityIndicator style={{ marginTop: 40 }} color={c.muted} />;
  const fraca = v.materias.find((m) => m.id === v.fraca);
  const soma = v.materias.reduce((t, m) => t + m.peso, 0) || 1;
  const dias = v.plano?.data ? Math.ceil((new Date(`${v.plano.data}T00:00:00`).getTime() - Date.now()) / 86_400_000) : null;
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Numero rotulo="Acerto geral" valor={pct(v.acerto)} />
        <Numero rotulo="Entregas" valor={String(v.entregas)} />
        <Numero rotulo="Revisar hoje" valor={String(v.vencem)} />
        <Numero rotulo="Faltam" valor={dias != null && dias > 0 ? `${dias} dias` : "—"} />
      </View>
      <View style={cartao()}>
        <Text style={s.secao2}>POR MATÉRIA</Text>
        {v.materias.map((m) => (
          <Pressable key={m.id} onPress={() => onAbrir(m.id)} style={({ pressed }) => ({ gap: 5, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: corAcerto(m.acerto) }} />
              <Text style={{ color: c.fg, fontSize: 14, flex: 1 }} numberOfLines={1}>{m.nome}</Text>
              <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{pct(m.acerto)} · peso {Math.round((100 * m.peso) / soma)}%</Text>
            </View>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
              <View style={{ height: 5, borderRadius: 3, width: `${m.acerto ?? 0}%`, backgroundColor: corAcerto(m.acerto) }} />
            </View>
            <Text style={{ color: c.faint, fontSize: 11.5 }}>{m.resumos.length} resumos · {m.provas} provas · {m.erros} no caderno de erros</Text>
          </Pressable>
        ))}
      </View>
      {fraca && (
        <View style={cartao()}>
          <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600" }}>Onde cada hora rende mais: {fraca.nome}</Text>
          <Text style={[s.muted, { lineHeight: 19 }]}>
            {Math.round((100 * fraca.peso) / soma)}% do peso e {fraca.acerto == null ? "nenhuma prova feita ainda" : `${fraca.acerto}% de acerto`}
            {fraca.fracos.length ? ` · mais fracos: ${fraca.fracos.join(", ")}` : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao flex rotulo="Abrir" icone={<ArrowRight size={14} color={c.fg} />} onPress={() => onAbrir(fraca.id)} />
            <Botao flex primario rotulo="Simulado dos fracos" onPress={onSimuladoFracos} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

/** O resumo geral: cada matéria com os resumos, os pontos fracos e o quadro "Revisão rápida" do último resumo. */
export function ResumoGeral({ casca, onAbrir }: { casca: Casca; onAbrir: (m: string) => void }) {
  const v = useVisao(casca);
  if (!v) return <ActivityIndicator style={{ marginTop: 40 }} color={c.muted} />;
  const comQuadro = v.materias.filter((m) => m.quadro);
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      {!!comQuadro.length && (
        <Botao rotulo="Compartilhar a folha da véspera" onPress={() => Share.share({ message: comQuadro.map((m) => `## ${m.nome}\n\n${m.quadro}`).join("\n\n") }).catch(() => {})} />
      )}
      {v.materias.map((m) => (
        <View key={m.id} style={cartao()}>
          <Pressable onPress={() => onAbrir(m.id)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: corAcerto(m.acerto) }} />
            <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600", flex: 1 }} numberOfLines={1}>{m.nome}</Text>
            <Text style={{ color: c.accentText, fontSize: 13 }}>abrir</Text>
          </Pressable>
          <Text style={{ color: c.faint, fontSize: 12 }}>
            {pct(m.acerto)}{m.erros ? ` · ${m.erros} no caderno de erros` : ""}{m.resumos.length ? ` · ${m.resumos.map((r) => r.titulo || "Resumo").join(" · ")}` : " · sem resumo ainda"}
          </Text>
          {!!m.fracos.length && <Text style={{ color: c.warn, fontSize: 12.5 }}>Mais fracos: {m.fracos.join(", ")}</Text>}
          {m.quadro ? <TextoRico texto={m.quadro} tamanho={14} />
            : !!m.secoes.length && (
              <View style={{ gap: 2 }}>
                {m.secoes.map((t, i) => <Text key={t} style={{ color: c.muted, fontSize: 13 }}>{i + 1}. {t}</Text>)}
                <Text style={{ color: c.faint, fontSize: 11.5, marginTop: 4 }}>Para a folha da véspera, ligue "Revisão rápida" nas preferências do próximo resumo.</Text>
              </View>
            )}
        </View>
      ))}
    </ScrollView>
  );
}

/** Ler o edital: colar ou mandar o arquivo; a IA propõe matérias, peso e tópicos; você confere e aplica. */
export function LerEdital({ casca, onFeito }: { casca: Casca; onFeito: () => void }) {
  const [texto, setTexto] = useState("");
  const [cargo, setCargo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ex, setEx] = useState<EstudosEdital | null>(casca.p?.edital ?? null);
  const [itens, setItens] = useState<(EstudosEditalItem & { marcada: boolean })[]>([]);
  const corte = useRef<AbortController | null>(null);
  const lendo = ex?.status === "rodando";
  useEffect(() => () => corte.current?.abort(), []);
  useEffect(() => { if (ex && !lendo) setItens(ex.proposta.map((x) => ({ ...x, marcada: true }))); }, [ex?.message_id, ex?.status]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function arquivo() {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }).catch(() => null);
    if (!r || r.canceled || casca.conv == null) return;
    setEnviando(true);
    try {
      const a = r.assets[0];
      setTexto((await enviaArquivo<{ texto: string }>(`/estudos/${casca.conv}/edital/arquivo`, { uri: a.uri, name: a.name, mimeType: a.mimeType })).texto);
    } catch (e: any) { casca.erro(e.message); } finally { setEnviando(false); }
  }

  async function ler() {
    if (texto.trim().length < 200) return toast("Cole o edital (ou o quadro de provas e o conteúdo programático).");
    if (!casca.modelo) return toast("Escolha um modelo em Modelos (ou no chat) antes.");
    corte.current?.abort();
    const ac = (corte.current = new AbortController());
    try {
      await streamSSE(`/estudos/${casca.conv}/edital`, (ev) => { if (ev.erro) casca.erro(ev.erro); else setEx(ev); }, ac.signal,
                      { texto, cargo, ...casca.modelo });
    } catch (e: any) { if (!ac.signal.aborted && !cancelado(e)) casca.erro(e.message); }
  }

  async function aplicar() {
    const marcadas = itens.filter((x) => x.marcada && x.nome.trim());
    if (!marcadas.length) return toast("Marque pelo menos uma matéria.");
    try {
      await api.post(`/estudos/${casca.conv}/edital/aplicar`, { materias: marcadas.map(({ nome, peso, topicos }) => ({ nome, peso, topicos })) });
      toast(`${marcadas.length} matérias criadas ou atualizadas.`);
      onFeito();
    } catch (e: any) { casca.erro(e.message); }
  }

  const muda = (i: number, x: Partial<EstudosEditalItem & { marcada: boolean }>) => setItens((v) => v.map((y, j) => (j === i ? { ...y, ...x } : y)));
  if (itens.length && !lendo)
    return (
      <View style={{ gap: 10 }}>
        <Text style={s.secao2}>MATÉRIAS DO EDITAL{ex?.cargo ? ` · ${ex.cargo.toUpperCase()}` : ""}</Text>
        {itens.map((x, i) => (
          <View key={i} style={{ gap: 6, borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 10, opacity: x.marcada ? 1 : 0.5 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable hitSlop={8} onPress={() => muda(i, { marcada: !x.marcada })} accessibilityRole="checkbox" accessibilityState={{ checked: x.marcada }}
                         style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: x.marcada ? c.accent : c.lineStrong,
                                  backgroundColor: x.marcada ? c.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
                {x.marcada && <Check size={14} color={c.accentFg} />}
              </Pressable>
              <TextInput value={x.nome} onChangeText={(nome) => muda(i, { nome })} maxLength={60} style={{ color: c.fg, fontSize: 14.5, flex: 1, padding: 0 }} />
              <Text style={{ color: x.existe ? c.faint : c.accentText, fontSize: 11.5 }}>{x.existe ? "atualiza" : "nova"}</Text>
            </View>
            <LinhaAjuste rotulo="Peso" sub={`${x.topicos.length} tópicos${x.questoes ? ` · ${x.questoes} questões no edital` : ""}`}>
              <Contador valor={x.peso} min={1} max={100} onMuda={(peso) => muda(i, { peso })} />
            </LinhaAjuste>
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Botao flex rotulo="Outro edital" onPress={() => { setItens([]); setEx(null); }} />
          <Botao flex primario rotulo={`Criar ${itens.filter((x) => x.marcada).length}`} icone={<Check size={14} color={c.accentFg} />} onPress={aplicar} />
        </View>
      </View>
    );
  return (
    <View style={{ gap: 10 }}>
      <Text style={[s.muted, { lineHeight: 19 }]}>
        Cole o edital ou mande o arquivo. A IA procura o quadro de provas e o conteúdo programático e propõe as matérias com peso e
        tópicos; você confere antes de criar. O edital não vira material de estudo.
      </Text>
      <Area valor={texto} onMuda={setTexto} placeholder="ANEXO II — CONTEÚDO PROGRAMÁTICO…" linhas={6} fixa />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Botao rotulo={enviando ? "Lendo…" : "Arquivo"} icone={<Paperclip size={14} color={c.fg} />} desabilitado={enviando || lendo} onPress={arquivo} />
        {!!texto && <Text style={{ color: c.faint, fontSize: 12 }}>{texto.length.toLocaleString("pt-BR")} caracteres</Text>}
      </View>
      <TextInput value={cargo} onChangeText={setCargo} placeholder="Cargo (se o edital tem vários)" placeholderTextColor={c.faint} maxLength={120} style={s.input} />
      {lendo && ex && <Text style={{ color: c.info, fontFamily: mono, fontSize: 11.5 }}>{ex.progresso || "começando…"}{numeros(ex) ? ` · ${numeros(ex)}` : ""}</Text>}
      {!lendo && !!ex?.aviso && <Text style={{ color: c.warn, fontSize: 13 }}>{ex.aviso}</Text>}
      <Botao primario altura={44} rotulo={lendo ? "Lendo o edital…" : "Ler o edital"} desabilitado={lendo || texto.trim().length < 200} onPress={ler} />
    </View>
  );
}

type Conversa = { id: number; title: string; kind: string; updated_at: string };

/** Trazer um estudo antigo para dentro deste objetivo, com todo o progresso; ele some da lista. */
export function TrazerEstudo({ casca, onFeito }: { casca: Casca; onFeito: () => void }) {
  const [lista, setLista] = useState<Conversa[] | null>(null);
  const [indo, setIndo] = useState<number | null>(null);
  useEffect(() => {
    api.get<Conversa[]>("/conversations").then((cs) => setLista(cs.filter((x) => x.kind === "estudos" && x.id !== casca.conv)))
      .catch((e) => casca.erro(e.message));
  }, [casca.conv]);   // eslint-disable-line react-hooks/exhaustive-deps
  function trazer(x: Conversa) {
    pergunta("Trazer este estudo?", `As matérias de “${x.title}” viram matérias daqui, com resumos, provas, notas e revisão. Ele sai da lista de estudos.`, [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Trazer", acao: async () => {
        setIndo(x.id);
        try { await api.post(`/estudos/${casca.conv}/juntar`, { de: x.id }); toast("Estudo trazido."); onFeito(); }
        catch (e: any) { casca.erro(e.message); } finally { setIndo(null); }
      } },
    ]);
  }
  if (!lista) return <ActivityIndicator color={c.muted} />;
  if (!lista.length) return <Text style={s.muted}>Não há outro estudo para trazer.</Text>;
  return (
    <View style={{ gap: 4 }}>
      {lista.map((x) => (
        <Pressable key={x.id} onPress={() => trazer(x)} disabled={indo != null}
                   style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 10, borderRadius: 10,
                                              backgroundColor: pressed ? c.raised : "transparent" })}>
          <Text style={{ color: c.fg, fontSize: 14.5, flex: 1 }} numberOfLines={1}>{x.title}</Text>
          {indo === x.id ? <ActivityIndicator size="small" color={c.muted} />
            : <Text style={{ color: c.faint, fontSize: 12 }}>{new Date(x.updated_at).toLocaleDateString("pt-BR")}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

/** A folha de uma matéria (toque longo no chip): nome, peso e tirar. */
export function FolhaMateria({ casca, m, onFecha, onTirou }: { casca: Casca; m: EstudosMateria | null; onFecha: () => void; onTirou: () => void }) {
  const [nome, setNome] = useState("");
  const [peso, setPeso] = useState(1);
  useEffect(() => { if (m) { setNome(m.nome); setPeso(m.peso ?? 1); } }, [m?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  async function salvar() {
    if (!m || !nome.trim()) return;
    try {
      await api.patch(`/estudos/${casca.conv}/materias/${m.id}`, { ...(nome.trim() !== m.nome ? { nome } : {}), peso });
      await casca.recarrega();
      onFecha();
    } catch (e: any) { casca.erro(e.message); }
  }
  function tirar() {
    if (!m) return;
    pergunta("Tirar a matéria?", `O que é de “${m.nome}” (resumos, provas, material) vai para o Geral; nada se apaga.`, [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Tirar", estilo: "perigo", acao: async () => {
        try { await api.del(`/estudos/${casca.conv}/materias/${m.id}`); onTirou(); await casca.recarrega(); onFecha(); }
        catch (e: any) { casca.erro(e.message); }
      } },
    ]);
  }
  return (
    <Folha aberta={!!m} titulo={m?.nome ?? "Matéria"} onFecha={onFecha}>
      <TextInput value={nome} onChangeText={setNome} maxLength={60} placeholder="Nome da matéria" placeholderTextColor={c.faint} style={s.input} />
      <LinhaAjuste rotulo="Peso" sub="no simulado geral e no cronograma: as questões no edital, por exemplo">
        <Contador valor={peso} min={1} max={100} onMuda={setPeso} />
      </LinhaAjuste>
      {!!m?.topicos?.length && <Text style={{ color: c.faint, fontSize: 12.5 }}>{m.topicos.length} tópicos do edital</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Botao flex rotulo="Tirar" icone={<Trash size={14} color={c.err} />} cor={c.err} onPress={tirar} />
        <Botao flex primario rotulo="Salvar" onPress={salvar} />
      </View>
    </Folha>
  );
}
