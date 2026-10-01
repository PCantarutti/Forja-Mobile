import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from "react-native-svg";
import { Text } from "./Texto";
import { api } from "./api";
import { pergunta } from "./Dialogo";
import { ArrowRight, Check, Clock, Trash } from "./icones";
import { c, mono, s } from "./tema";
import { Botao, BotaoIcone, Chip, Contador, LinhaAjuste, toast } from "./ui";
import { type Casca, type EstudosDesempenho, type EstudosPlano, type EstudosTarefa, type ProvaPendente, nota, quando } from "./estudosTipos";

// Aba Desempenho (EstudosDesempenho do desktop): o gráfico das notas, o acerto por tópico com a prova dos pontos
// fracos, o atalho da revisão e o cronograma até a prova. Tudo pelo GET /estudos/{conv}/desempenho; o cronograma
// grava pelo PC e por aqui, e os dois lados se veem na hora (carimbo da casca).

const H = 150, PX_E = 26, PX_D = 10, PY = 14;   // gráfico: altura e as folgas (à esquerda cabem os números)
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const ATALHOS_DIAS = [7, 14, 30, 60];

/** AAAA-MM-DD no fuso daqui (o toISOString é UTC: depois das 21h já seria amanhã). */
const isoLocal = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
/** O dia ao meio-dia local: assim o fuso não muda a data ao converter. */
const meioDia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
/** "seg 12/10". */
function diaCurto(iso: string) {
  const x = meioDia(iso);
  return `${SEMANA[x.getDay()]} ${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
}
/** A data daqui a N dias, em AAAA-MM-DD local. */
function daquiA(dias: number) {
  const x = new Date();
  x.setDate(x.getDate() + dias);
  return isoLocal(x);
}
const diasAte = (iso: string) => Math.round((meioDia(iso).getTime() - meioDia(isoLocal(new Date())).getTime()) / 86_400_000);
const corPct = (p: number) => (p >= 0.7 ? c.ok : p >= 0.4 ? c.amber : c.err);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Cartão padrão da tela (o mesmo da Pesquisa e do Design). Montado por render: o `c` muda com o tema. */
function Cartao({ children, gap = 8 }: { children: ReactNode; gap?: number }) {
  return <View style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap }}>{children}</View>;
}
const Titulo = ({ t }: { t: string }) => <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600" }}>{t}</Text>;

/** As notas na ordem das entregas; treino em ponto vazado. Tocar num ponto diz qual prova foi. */
function Grafico({ entregas, largura }: { entregas: EstudosDesempenho["entregas"]; largura: number }) {
  const n = entregas.length;
  const W = Math.max(largura, 120);
  const x = (i: number) => (n === 1 ? (PX_E + W - PX_D) / 2 : PX_E + (i * (W - PX_E - PX_D)) / (n - 1));
  const y = (v: number) => PY + (1 - Math.min(10, Math.max(0, v)) / 10) * (H - 2 * PY);
  return (
    <View accessible accessibilityLabel="Notas das entregas">
      <Svg width={W} height={H}>
        {[0, 5, 7, 10].map((v) => (
          <G key={v}>
            <Line x1={PX_E} x2={W - PX_D} y1={y(v)} y2={y(v)} stroke={v === 7 ? c.ok : c.line} strokeOpacity={v === 7 ? 0.45 : 1}
                  strokeWidth={1} strokeDasharray={v === 7 ? "4 4" : undefined} />
            <SvgText x={PX_E - 8} y={y(v) + 4} textAnchor="end" fill={c.faint} fontFamily={mono} fontSize={11}>{v}</SvgText>
          </G>
        ))}
        {n > 1 && (
          <Polyline fill="none" stroke={c.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                    points={entregas.map((e, i) => `${x(i)},${y(e.nota)}`).join(" ")} />
        )}
        {entregas.map((e, i) => {
          const diz = () => toast(`${e.titulo}${e.modo === "treino" ? " (treino)" : ""}: ${nota(e.nota)} · ${quando(e.criado)}`);
          return (
            <G key={e.message_id}>
              <Circle cx={x(i)} cy={y(e.nota)} r={4.5} strokeWidth={2} stroke={c.accent} fill={e.modo === "treino" ? c.surface : c.accent} />
              {/* alvo de toque maior que o ponto (invisível: a opacidade zero ainda recebe o toque, o fill none não) */}
              <Circle cx={x(i)} cy={y(e.nota)} r={14} fill={c.accent} fillOpacity={0} onPress={diz} />
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

/** Acerto por tópico: a barra soma todas as entregas; o traço vertical é a última. Nome em âmbar = ponto fraco. */
function Topicos({ d, onProva }: { d: EstudosDesempenho; onProva: (p: ProvaPendente) => void }) {
  const testados = d.topicos.filter((t) => t.pct !== null);
  return (
    <Cartao gap={10}>
      <View style={{ gap: 2 }}>
        <Titulo t="Acerto por tópico" />
        <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>somando todas as entregas; o traço é a última</Text>
      </View>
      <View style={{ gap: 10 }}>
        {d.topicos.map((t) => {
          const fraco = d.fracos.includes(t.topico);
          return (
            <View key={t.topico} style={{ gap: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ color: fraco ? c.amber : c.muted, fontSize: 13, lineHeight: 18, flex: 1 }} numberOfLines={2}>{t.topico}</Text>
                <Text style={{ color: t.pct === null ? c.faint : fraco ? c.amber : c.fg2, fontFamily: mono, fontSize: 12 }}>
                  {t.pct === null ? "sem questão" : `${Math.round(t.pct * 100)}%`}
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.raised }}>
                {t.pct !== null && <View style={{ height: 6, borderRadius: 3, width: `${Math.round(t.pct * 100)}%`, backgroundColor: corPct(t.pct) }} />}
                {t.ultima !== null && (
                  <View style={{ position: "absolute", top: -3, left: `${Math.round(t.ultima * 100)}%`, marginLeft: -1, width: 2, height: 12,
                                 borderRadius: 1, backgroundColor: c.fg, opacity: 0.7 }} />
                )}
              </View>
            </View>
          );
        })}
      </View>
      {!testados.length && <Text style={[s.faint, { lineHeight: 19 }]}>Nenhum tópico com questão feita ainda.</Text>}
      {!!d.fracos.length && (
        <Botao primario altura={40} rotulo="Prova dos pontos fracos" estilo={{ marginTop: 2 }}
               onPress={() => onProva({ topicos: d.fracos, instrucoes: `Prova dos pontos fracos: foque no que o aluno mais erra em ${d.fracos.join(", ")}.` })} />
      )}
    </Cartao>
  );
}

/** O cronograma até a prova: sem plano, o formulário; com plano, os próximos 7 dias (hoje em destaque) e as tarefas marcáveis. */
function Cronograma({ conv, plano, lembrete, onMarca, onMudou, onProva, onIr, onErro }: {
  conv: number; plano: EstudosPlano | null; lembrete: boolean;
  onMarca: (t: EstudosTarefa, feito: boolean) => void;   // marca no estado local na hora (o POST confirma)
  onMudou: () => Promise<void>; onProva: (p: ProvaPendente) => void; onIr: (aba: "resumo" | "revisao") => void; onErro: (e: string) => void;
}) {
  const hoje = isoLocal(new Date());
  // O formulário pede dias (não data): no celular um stepper vale mais que um calendário. Refazer parte do plano atual.
  const [dias, setDias] = useState(() => (plano ? Math.max(1, Math.min(180, diasAte(plano.data))) : 14));
  const [minutos, setMinutos] = useState(plano?.minutos ?? 60);
  const [editando, setEditando] = useState(!plano);
  const [salvando, setSalvando] = useState(false);
  const [todos, setTodos] = useState(false);

  async function montar() {
    setSalvando(true);
    try {
      await api.post(`/estudos/${conv}/cronograma`, { data: daquiA(dias), minutos });
      setEditando(false);
      await onMudou();
      toast(plano ? "Cronograma refeito." : "Cronograma montado.");
    } catch (e: any) {
      onErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function marcar(t: EstudosTarefa) {
    onMarca(t, !t.feito);
    try {
      await api.post(`/estudos/${conv}/cronograma/marcar`, { tarefa_id: t.id, feito: !t.feito });
    } catch (e: any) {
      onErro(e.message);
    }
    await onMudou();   // confirma (ou desfaz, se o PC não aceitou)
  }

  function apagar() {
    pergunta("Apagar o cronograma?", "As tarefas e o que já foi marcado somem. Dá para montar outro depois.", [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Apagar", estilo: "perigo", acao: async () => {
        try { await api.del(`/estudos/${conv}/cronograma`); } catch (e: any) { onErro(e.message); }
        setEditando(true);
        await onMudou();
      } },
    ]);
  }

  const tarefas = plano?.dias.flatMap((d) => d.tarefas) ?? [];
  const feitas = tarefas.filter((t) => t.feito).length;
  const lista = plano?.dias.filter((d) => todos || d.dia >= hoje).slice(0, todos ? undefined : 7) ?? [];
  const acaoDe = (t: EstudosTarefa) =>
    t.tipo === "simulado" ? { rotulo: "gerar", on: () => onProva({ topicos: [], instrucoes: "Simulado: todos os tópicos, no estilo da prova." }) }
    : t.tipo === "revisar" ? { rotulo: "revisar", on: () => onIr("revisao") }
    : { rotulo: "ler", on: () => onIr("resumo") };

  return (
    <Cartao gap={10}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 }}>
        <Clock size={16} color={c.faint} />
        <View style={{ flex: 1 }}><Titulo t="Cronograma" /></View>
        {plano && !editando && (
          <>
            <Botao rotulo="Refazer" altura={32} onPress={() => setEditando(true)} />
            <BotaoIcone lado={32} onPress={apagar}><Trash size={15} color={c.muted} /></BotaoIcone>
          </>
        )}
      </View>

      {plano && !editando && (
        <View style={{ gap: 6 }}>
          <Text style={[s.muted, { lineHeight: 19 }]}>
            até a prova em {diaCurto(plano.data)} · {plano.minutos} min por dia · {feitas} de {plural(tarefas.length, "tarefa feita", "tarefas feitas")}
          </Text>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.raised, overflow: "hidden" }}>
            <View style={{ height: 4, width: `${tarefas.length ? Math.round((feitas / tarefas.length) * 100) : 0}%`, backgroundColor: c.accent }} />
          </View>
        </View>
      )}

      {editando && (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 8 }}>
            <LinhaAjuste rotulo="Dias até a prova" sub={`prova em ${diaCurto(daquiA(dias))}`}>
              <Contador valor={dias} onMuda={setDias} min={1} max={180} fmt={(n) => plural(n, "dia", "dias")} />
            </LinhaAjuste>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {ATALHOS_DIAS.map((n) => <Chip key={n} rotulo={`${n} dias`} ativo={dias === n} onPress={() => setDias(n)} />)}
            </View>
          </View>
          <LinhaAjuste rotulo="Minutos por dia">
            <Contador valor={minutos} onMuda={setMinutos} min={15} max={600} passo={15} sufixo=" min" />
          </LinhaAjuste>
          <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>
            Um tópico por dia (os seus pontos fracos voltam mais vezes), revisão dos cartões e erros todo dia e um simulado por
            semana e na véspera.{lembrete && " O celular avisa a tarefa do dia às 8h."}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao primario flex altura={40} rotulo={plano ? "Refazer o cronograma" : "Montar o cronograma"} desabilitado={salvando} onPress={montar} />
            {plano && <Botao altura={40} rotulo="Voltar" desabilitado={salvando} onPress={() => setEditando(false)} />}
          </View>
        </View>
      )}

      {plano && !editando && (
        <View style={{ gap: 6 }}>
          {lista.map((d) => {
            const eHoje = d.dia === hoje;
            return (
              <View key={d.dia} style={{ borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 2,
                                        borderColor: eHoje ? c.accentLine : c.line, backgroundColor: eHoje ? c.accentSoft : "transparent",
                                        opacity: d.dia < hoje ? 0.6 : 1 }}>
                <Text style={{ color: eHoje ? c.accentText : c.faint, fontFamily: mono, fontSize: 11.5, marginBottom: 2 }}>
                  {eHoje ? `hoje · ${diaCurto(d.dia)}` : diaCurto(d.dia)}
                </Text>
                {d.tarefas.map((t) => {
                  const acao = eHoje && !t.feito ? acaoDe(t) : null;
                  return (
                    <Pressable key={t.id} onPress={() => marcar(t)} accessibilityRole="checkbox" accessibilityState={{ checked: t.feito }}
                               accessibilityLabel={t.texto} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 36, paddingVertical: 4 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, marginTop: 1, alignItems: "center", justifyContent: "center",
                                     borderColor: t.feito ? c.ok : c.lineStrong, backgroundColor: t.feito ? c.okSoft : "transparent" }}>
                        {t.feito && <Check size={14} color={c.ok} />}
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={{ color: t.feito ? c.faint : c.fg, fontSize: 13.5, lineHeight: 19, textDecorationLine: t.feito ? "line-through" : "none" }}>{t.texto}</Text>
                        {acao && (
                          <Pressable onPress={acao.on} hitSlop={8} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
                            <Text style={{ color: c.accentText, fontSize: 13, fontWeight: "600" }}>{acao.rotulo}</Text>
                            <ArrowRight size={13} color={c.accentText} />
                          </Pressable>
                        )}
                      </View>
                      <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5, marginTop: 2 }}>{t.minutos} min</Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
          {!lista.length && <Text style={[s.faint, { lineHeight: 19 }]}>O plano acabou: a prova era {diaCurto(plano.data)}. Refaça para a próxima.</Text>}
          {plano.dias.length > lista.length && !todos && (
            <Pressable onPress={() => setTodos(true)} hitSlop={6} style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
              <Text style={s.muted}>ver os {plano.dias.length} dias</Text>
            </Pressable>
          )}
        </View>
      )}
    </Cartao>
  );
}

/** Aba Desempenho: notas, acerto por tópico, pontos fracos, revisão e cronograma. */
export default function Desempenho({ casca, onProva }: { casca: Casca; onProva: (p: ProvaPendente) => void }) {
  const [d, setD] = useState<EstudosDesempenho | null>(null);
  const [semEstudo, setSemEstudo] = useState(false);   // 404: a conversa ainda não tem estudo
  const [falhou, setFalhou] = useState(false);
  const [puxando, setPuxando] = useState(false);
  const { width } = useWindowDimensions();
  const ref = useRef(casca);
  ref.current = casca;   // a casca é um objeto novo a cada render: os callbacks leem a última

  const carregar = useCallback(async () => {
    const conv = ref.current.conv;
    if (conv == null) return;
    try {
      setD(await api.get<EstudosDesempenho>(`/estudos/${conv}/desempenho`));
      setSemEstudo(false); setFalhou(false);
    } catch (e: any) {
      if (e?.status === 404) setSemEstudo(true);
      else { setFalhou(true); ref.current.erro(e.message); }
    }
  }, []);
  // O que o projeto da casca já diz que mudou (entrega nova, plano novo, revisão): recarrega sem esperar o carimbo.
  const chaveP = `${casca.p?.provas.reduce((n, x) => n + x.tentativas.length, 0) ?? 0}|${casca.p?.revisao?.plano?.criado ?? ""}|${casca.p?.revisao?.vencem ?? ""}`;
  useEffect(() => { carregar(); }, [carregar, casca.conv, casca.carimbo, chaveP]);

  const mudou = useCallback(async () => { await Promise.all([carregar(), ref.current.recarrega()]); }, [carregar]);
  const puxar = async () => { setPuxando(true); try { await mudou(); } finally { setPuxando(false); } };
  /** Marca a tarefa no estado daqui na hora; o POST e o recarregar confirmam. */
  const marcaLocal = (t: EstudosTarefa, feito: boolean) => setD((x) => x?.plano
    ? { ...x, plano: { ...x.plano, dias: x.plano.dias.map((dia) => ({ ...dia, tarefas: dia.tarefas.map((y) => (y.id === t.id ? { ...y, feito } : y)) })) } }
    : x);

  const entregas = d?.entregas ?? [];
  const ultima = entregas[entregas.length - 1];
  const provas = entregas.filter((e) => e.modo === "prova");
  const media = provas.length ? provas.reduce((soma, e) => soma + e.nota, 0) / provas.length : 0;
  const larguraCartao = width - 2 * 14 - 2 * 12 - 2;   // tela 14, cartão 12, bordas

  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={puxando} onRefresh={puxar} tintColor={c.muted} colors={[c.accent]} progressBackgroundColor={c.raised} />}>
      {casca.conv == null || semEstudo ? (
        <Cartao>
          <Titulo t="Nada para medir ainda" />
          <Text style={[s.muted, { lineHeight: 19 }]}>Gere o resumo e faça uma prova primeiro. As notas, o acerto por tópico e o cronograma aparecem aqui.</Text>
          <Botao altura={40} rotulo="Ir para o resumo" icone={<ArrowRight size={14} color={c.fg} />} onPress={() => casca.setAba("resumo")} />
        </Cartao>
      ) : !d ? (
        <View style={{ paddingVertical: 48, alignItems: "center", gap: 12 }}>
          {falhou ? <Botao altura={40} rotulo="Tentar de novo" onPress={carregar} /> : <ActivityIndicator color={c.muted} />}
        </View>
      ) : (
        <>
          <Cartao>
            <Text style={s.secao2}>{ultima?.modo === "treino" ? "ÚLTIMO TREINO" : "ÚLTIMA PROVA"}</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text style={{ color: c.fg, fontFamily: mono, fontSize: 40, fontWeight: "600", lineHeight: 46, includeFontPadding: false }}>
                {ultima ? nota(ultima.nota) : "—"}
              </Text>
              {!!ultima && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 16 }}>/ 10</Text>}
            </View>
            <Text style={[s.muted, { lineHeight: 19 }]}>
              {plural(entregas.length, "entrega", "entregas")} · média das provas {provas.length ? nota(media) : "—"}
            </Text>
            {entregas.length ? (
              <>
                <Grafico entregas={entregas} largura={larguraCartao} />
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>ponto cheio = prova · ponto vazado = treino · tracejado = 7</Text>
              </>
            ) : (
              <>
                <Text style={[s.faint, { lineHeight: 19 }]}>Faça uma prova (ou um treino) na aba Provas para ver a evolução aqui.</Text>
                <Botao altura={40} rotulo="Abrir as provas" icone={<ArrowRight size={14} color={c.fg} />} onPress={() => casca.setAba("provas")} />
              </>
            )}
          </Cartao>

          {!!d.topicos.length && <Topicos d={d} onProva={onProva} />}

          <Cartao>
            <Titulo t="Revisão" />
            <Text style={[s.muted, { lineHeight: 19 }]}>
              <Text style={{ color: c.fg, fontWeight: "600" }}>{d.revisao.vencem}</Text> para hoje · {d.revisao.erros} no caderno de erros
              · {plural(d.revisao.cartoes, "cartão", "cartões")} · {plural(d.revisao.dominados, "dominado", "dominados")}
            </Text>
            <Botao altura={40} rotulo="Abrir a revisão" icone={<ArrowRight size={14} color={c.fg} />} onPress={() => casca.setAba("revisao")} />
          </Cartao>

          <Cronograma key={d.plano?.criado ?? "novo"} conv={casca.conv} plano={d.plano} lembrete={d.lembrete} onMarca={marcaLocal} onMudou={mudou}
                      onProva={onProva} onIr={casca.setAba} onErro={casca.erro} />
        </>
      )}
    </ScrollView>
  );
}
