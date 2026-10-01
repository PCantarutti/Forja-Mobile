import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StatusBar, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "./Texto";
import { api, base, comToken, lerAjustes, salvaAjustes } from "./api";
import { pergunta } from "./Dialogo";
import { ConversaDuvida } from "./EstudosDuvidas";
import { TextoRico } from "./Formula";
import { ArrowLeft, ArrowRight, Bubble, Check, Clock, Pin, Prancheta, Refresh, Trash, X } from "./icones";
import { BotaoEnviar } from "./Imagens";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Area, Botao, BotaoIcone, Chip, Contador, Folha, LinhaAjuste, Opcao, Pulsa, Recolhivel, Seletor, Selo, toast } from "./ui";
import { type Casca, type EstudosPlanejada, type EstudosProva, type EstudosProvaConfig, type EstudosProvaResumo, type EstudosQuestao, type EstudosFigura,
         type EstudosTentativa, type ProvaPendente, DIFICULDADE, LETRAS, PEDIDO_CLAUDE, TIPO_CURTO, nota, numeros, quando, relogio } from "./estudosTipos";

// Aba Provas da tela Estudos (EstudosProva.tsx do desktop): a lista de provas com as entregas, a folha "Nova prova",
// fazer a prova (uma questão por tela, com relógio) ou treinar (correção na hora, dicas) e o resultado corrigido.

type Resposta = number | boolean | string;
/** O que o modo treino recebe ao conferir uma questão: o gabarito e a explicação dela. */
type Conferida = Pick<EstudosQuestao, "correta" | "explicacao" | "por_alternativa" | "resposta_modelo" | "rubrica" | "pagina"> & { certa: boolean | null };
type Rascunho = { respostas: Record<string, Resposta>; marcadas: string[]; atual: number; inicio: number; conferidas: Record<string, Conferida> };
type Vista = { tipo: "lista" } | { tipo: "fazer"; prova: EstudosProva; treino: boolean } | { tipo: "resultado"; t: EstudosTentativa };
type Cfg = Pick<EstudosProvaConfig, "me" | "vf" | "disc" | "dificuldade" | "estilo" | "tempo" | "topicos"> & { figuras?: number; distribuicao?: "peso" | "fracos" };
type Estado = "neutra" | "minha" | "certa" | "errada";

const PADRAO: Cfg = { me: 8, vf: 2, disc: 0, dificuldade: "mista", estilo: true, tempo: 0, topicos: [] };
const DIFICULDADES: { id: Cfg["dificuldade"]; rotulo: string; dica: string }[] = [
  { id: "mista", rotulo: "Misturada", dica: "Mais média, com algumas fáceis e difíceis" },
  { id: "facil", rotulo: "Fácil", dica: "Lembrar conceitos" },
  { id: "media", rotulo: "Média", dica: "Aplicar a uma situação" },
  { id: "dificil", rotulo: "Difícil", dica: "Relacionar conceitos, interpretar dados, calcular" },
];
// Bordas suaves dos estados (as cores de estado não mudam com o tema; o mesmo verde da faixa da Pesquisa).
const LINHA = { ok: "rgba(95,211,154,0.5)", err: "rgba(226,122,107,0.5)", warn: "rgba(242,161,74,0.5)" };
const cartao = () => ({ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 });
// Respostas em andamento ficam na memória do app (o desktop usa o localStorage): sair da prova e voltar não perde
// nada, e um texto discursivo longo não cabe no SecureStore.
const RASCUNHOS = new Map<string, Rascunho>();
const chaveRascunho = (id: number, treino: boolean) => `${id}:${treino ? "treino" : "prova"}`;
const pedidas = (cfg?: Partial<EstudosProvaConfig>) => (cfg?.me ?? 0) + (cfg?.vf ?? 0) + (cfg?.disc ?? 0);
const resumoCfg = (cfg?: Partial<EstudosProvaConfig>) =>
  (["me", "vf", "disc"] as const).filter((k) => cfg?.[k]).map((k) => `${cfg![k]} ${TIPO_CURTO[k]}`).join(" · ");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const corNota = (n: number) => (n >= 7 ? c.ok : n >= 5 ? c.amber : c.err);
/** Borda, fundo e cor do texto de uma alternativa (ou do V/F) em cada estado. */
const cores = (e: Estado): [string, string, string] =>
  e === "certa" ? [LINHA.ok, c.okSoft, c.ok] : e === "errada" ? [LINHA.err, c.errSoft, c.err]
  : e === "minha" ? [c.accentLine, c.accentSoft, c.accentText] : [c.line, c.surface, c.fg];

// ------------------------------------------------------------------ peças

function AguardandoClaude({ texto, onCancelar }: { texto: string; onCancelar: () => void }) {
  return (
    <View style={cartao()}>
      <Text style={{ color: c.fg, fontSize: 14.5 }}>Pedido enviado ao Claude</Text>
      <Text style={[s.muted, { lineHeight: 19 }]}>{texto} No Claude Code conectado ao Forja, peça: “{PEDIDO_CLAUDE}”. A tela atualiza sozinha.</Text>
      <Botao rotulo="Cancelar pedido" icone={<X size={14} color={c.fg} />} estilo={{ alignSelf: "flex-start" }} onPress={onCancelar} />
    </View>
  );
}

/** A figura do PDF que a questão usa: fundo branco (é recorte de página impressa; no tema escuro o traço preto
 *  sumia), proporção já reservada pelo w/h, toque abre em tela cheia. Material apagado: some sem quebrar. */
export function FiguraQuestao({ conv, f }: { conv: number | null; f?: EstudosFigura }) {
  const [aberta, setAberta] = useState(false);
  const [falhou, setFalhou] = useState("");   // a uri que falhou: a próxima questão (outra figura) aparece
  const janela = useWindowDimensions();
  const uri = f && conv != null ? comToken(`${base()}/api/estudos-figura/${conv}/${f.material}/${f.id}`) : "";
  if (!f || !uri || falhou === uri) return null;
  const proporcao = f.w && f.h ? f.w / f.h : 1.4;
  // tela cheia: a maior largura que ainda cabe na altura (figura alta, ou o celular deitado)
  const larguraCheia = Math.min(janela.width - 20, (janela.height - 140) * proporcao);
  return (
    <>
      <Pressable onPress={() => setAberta(true)} accessibilityRole="imagebutton" accessibilityLabel={f.descricao || "Figura da questão; toque para ampliar"}
                 style={{ backgroundColor: "#fff", borderRadius: 12, padding: 8, borderWidth: 1, borderColor: c.line }}>
        <Image source={{ uri }} onError={() => setFalhou(uri)} resizeMode="contain"
               style={{ width: "100%", aspectRatio: proporcao, maxHeight: 420 }} />
      </Pressable>
      <Modal visible={aberta} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAberta(false)}>
        <StatusBar barStyle="light-content" />
        <Pressable onPress={() => setAberta(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,.94)", justifyContent: "center", padding: 10 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 10, padding: 6, alignSelf: "center" }}>
            <Image source={{ uri }} resizeMode="contain" style={{ width: larguraCheia, aspectRatio: proporcao }} />
          </View>
          <Text style={{ color: "#bbb", textAlign: "center", marginTop: 14, fontSize: 13 }}>Toque para fechar · gire o celular para ver maior</Text>
        </Pressable>
      </Modal>
    </>
  );
}

/** A geração em andamento: um quadradinho por questão planejada (fila, escrevendo, pronta, descartada). */
function Gerando({ p }: { p: EstudosProva }) {
  const COR: Record<EstudosPlanejada["status"], string> = { fila: c.line, gerando: c.info, verificando: c.info, ok: c.ok, descartada: c.err };
  const prontas = p.planejadas.filter((x) => x.status === "ok").length;
  return (
    <View style={cartao()}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pulsa cor={c.info} />
        <Text style={{ color: c.fg, fontSize: 14.5, flex: 1 }}>{p.etapa === "conferindo" ? "Conferindo o gabarito"
          : p.etapa === "figuras" ? `Olhando as figuras do PDF${p.figuras_olhadas ? ` · ${p.figuras_olhadas}` : ""}` : "Escrevendo as questões"}</Text>
        {!!p.planejadas.length && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{prontas} de {p.planejadas.length}</Text>}
      </View>
      {!!p.planejadas.length && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {p.planejadas.map((x) => <View key={x.id} style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: COR[x.status] ?? c.line }} />)}
        </View>
      )}
      <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{numeros(p) || "começando…"}</Text>
      {!!p.aviso && <Text style={{ color: c.warn, fontSize: 13, lineHeight: 19 }}>{p.aviso}</Text>}
    </View>
  );
}

function Corrigindo({ t }: { t: EstudosTentativa }) {
  const discs = Object.values(t.correcao).filter((x) => typeof x.resposta === "string" && x.resposta);
  const feitas = discs.filter((x) => !x.pendente).length;
  return (
    <View style={cartao()}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pulsa cor={c.info} />
        <Text style={{ color: c.fg, fontSize: 14.5, flex: 1 }}>Corrigindo as discursivas</Text>
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{feitas} de {discs.length}</Text>
      </View>
      {!!numeros(t) && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{numeros(t)}</Text>}
    </View>
  );
}

/** Uma alternativa de múltipla escolha: a letra num círculo, o texto (pode ter fórmula) e o porquê embaixo. */
function Alternativa({ letra, texto, estado, onPress, porque, direita }:
  { letra: string; texto: string; estado: Estado; onPress?: () => void; porque?: string; direita?: ReactNode }) {
  const [borda, fundo, cor] = cores(estado);
  const neutra = estado === "neutra";
  return (
    <Pressable onPress={onPress} disabled={!onPress}
               style={({ pressed }) => ({ borderRadius: 12, borderWidth: 1, borderColor: borda, backgroundColor: pressed && onPress ? c.raised : fundo, padding: 10, gap: 6 })}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center",
                       borderColor: neutra ? c.lineStrong : estado === "minha" ? c.accent : cor, backgroundColor: estado === "minha" ? c.accent : "transparent" }}>
          <Text style={{ color: neutra ? c.muted : estado === "minha" ? c.accentFg : cor, fontFamily: mono, fontSize: 12, fontWeight: "600" }}>{letra}</Text>
        </View>
        <View style={{ flex: 1, paddingTop: 2 }}><TextoRico texto={texto} fundo={c.surface} /></View>
        {direita}
      </View>
      {!!porque && <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18, marginLeft: 36 }}>{porque}</Text>}
    </Pressable>
  );
}

function BotaoVF({ rotulo, estado, onPress }: { rotulo: string; estado: Estado; onPress: () => void }) {
  const [borda, fundo, cor] = cores(estado);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: borda,
                                                            backgroundColor: pressed ? c.raised : fundo, alignItems: "center", justifyContent: "center" })}>
      <Text style={{ color: cor, fontSize: 15, fontWeight: estado === "neutra" ? "400" : "600" }}>{rotulo}</Text>
    </Pressable>
  );
}

/** Caixa de apoio dentro do cartão da questão (o porquê, a resposta esperada, sua resposta). */
function Caixinha({ rotulo, cor = c.faint, children }: { rotulo: string; cor?: string; children: ReactNode }) {
  return (
    <View style={{ borderRadius: 12, backgroundColor: c.raised, padding: 12, gap: 6 }}>
      <Text style={[s.secao2, { color: cor }]}>{rotulo}</Text>
      {children}
    </View>
  );
}

// ------------------------------------------------------------------ fazer a prova

function FazerProva({ casca, prova, treino, entregando, onEntregar, onSair }: {
  casca: Casca; prova: EstudosProva; treino: boolean; entregando: boolean;
  onEntregar: (respostas: Record<string, Resposta>, segundos: number) => void; onSair: () => void;
}) {
  const chave = chaveRascunho(prova.message_id, treino);
  const [r, setR] = useState<Rascunho>(() => RASCUNHOS.get(chave) ?? { respostas: {}, marcadas: [], atual: 0, inicio: Date.now(), conferidas: {} });
  const [agora, setAgora] = useState(() => Date.now());
  const [conferindo, setConferindo] = useState(false);
  const autoEntregue = useRef(false);
  const fila = useRef<ScrollView>(null);
  const inset = useSafeAreaInsets();
  const qs = prova.questoes;
  const q = qs[Math.min(r.atual, qs.length - 1)];
  const decorrido = Math.max(0, Math.floor((agora - r.inicio) / 1000));
  const limite = treino ? 0 : (prova.config?.tempo || 0) * 60;   // treino é sem relógio
  const resta = limite ? limite - decorrido : 0;
  const feita = (id: string) => r.respostas[id] !== undefined && r.respostas[id] !== "";
  const respondidas = qs.filter((x) => feita(x.id)).length;
  const faltam = qs.length - respondidas;
  const conf = r.conferidas[q.id];   // modo treino: esta já foi conferida (resposta travada, gabarito à vista)
  const respondida = feita(q.id);
  const marcada = r.marcadas.includes(q.id);

  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { RASCUNHOS.set(chave, r); }, [chave, r]);
  // A fila de números acompanha a questão aberta (34 de quadrado + 6 de espaço).
  useEffect(() => { fila.current?.scrollTo({ x: Math.max(0, r.atual * 40 - 140), animated: true }); }, [r.atual]);

  const entregar = () => { if (!entregando) onEntregar(r.respostas, decorrido); };
  // Acabou o tempo: entrega sozinha, uma vez só (se falhar, o botão continua lá).
  useEffect(() => {
    if (limite && resta <= 0 && !autoEntregue.current) { autoEntregue.current = true; toast("Acabou o tempo: entregando a prova…"); entregar(); }
  }, [limite, resta]);   // eslint-disable-line react-hooks/exhaustive-deps

  const responder = (v: Resposta) => { if (!conf) setR((x) => ({ ...x, respostas: { ...x.respostas, [q.id]: v } })); };
  const ir = (i: number) => setR((x) => ({ ...x, atual: Math.max(0, Math.min(qs.length - 1, i)) }));
  const marcar = () => setR((x) => ({ ...x, marcadas: marcada ? x.marcadas.filter((m) => m !== q.id) : [...x.marcadas, q.id] }));

  async function conferir() {
    if (!treino || conf || !respondida || conferindo) return;
    setConferindo(true);
    try {
      const cf = await api.post<Conferida>(`/estudos/prova/${prova.message_id}/conferir`, { questao_id: q.id, resposta: r.respostas[q.id] });
      setR((x) => ({ ...x, conferidas: { ...x.conferidas, [q.id]: cf } }));
    } catch (e: any) { casca.erro(e.message); } finally { setConferindo(false); }
  }

  function pedirEntrega() {
    if (entregando) return;
    if (!faltam && !r.marcadas.length) return entregar();
    const partes = [faltam ? `${faltam} sem resposta` : "", r.marcadas.length ? `${r.marcadas.length} marcada(s) para revisar` : ""].filter(Boolean).join(" e ");
    pergunta(treino ? "Terminar o treino?" : "Entregar a prova?", `${partes}. Entregar assim mesmo?`,
             [{ texto: "Voltar", estilo: "cancelar" }, { texto: "Entregar", acao: entregar }]);
  }

  const estadoDe = (v: Resposta): Estado => {
    const minha = r.respostas[q.id] === v;
    return conf && conf.correta === v ? "certa" : conf && minha ? "errada" : minha ? "minha" : "neutra";
  };
  const corRelogio = limite && resta < 300 ? c.amber : c.muted;
  const meta = [`Questão ${r.atual + 1} de ${qs.length}`, TIPO_CURTO[q.tipo], q.topico, DIFICULDADE[q.dificuldade] ?? q.dificuldade,
                `vale ${nota(q.pontos)} ponto${q.pontos === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable hitSlop={10} onPress={onSair} accessibilityLabel="Sair (as respostas ficam guardadas)"><ArrowLeft size={20} color={c.muted} /></Pressable>
          <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600", flex: 1 }} numberOfLines={1}>{prova.titulo}</Text>
          {!treino && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Clock size={13} color={corRelogio} />
              <Text style={{ color: corRelogio, fontFamily: mono, fontSize: 12.5 }}>{relogio(limite ? Math.max(0, resta) : decorrido)}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={s.muted}>{respondidas} de {qs.length} respondidas</Text>
          {treino && <Selo t="treino · correção na hora" cor={c.accentText} fundo={c.accentSoft} />}
        </View>
      </View>

      <ScrollView ref={fila} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
                  contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 6 }}>
        {qs.map((x, i) => {
          const cf = r.conferidas[x.id];
          const atual = i === r.atual;
          const [borda, fundo, cor] = cf ? cores(cf.certa === true ? "certa" : cf.certa === false ? "errada" : "minha")
            : feita(x.id) ? cores("minha") : [c.line, "transparent", c.faint];
          return (
            <Pressable key={x.id} onPress={() => ir(i)} accessibilityLabel={`Questão ${i + 1}${r.marcadas.includes(x.id) ? ", marcada" : ""}`}
                       style={{ width: 34, height: 34, borderRadius: 9, borderWidth: atual ? 2 : 1, borderColor: atual ? c.accent : borda,
                                backgroundColor: fundo, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: atual ? c.fg : cor, fontFamily: mono, fontSize: 12.5, fontWeight: atual ? "600" : "400" }}>{i + 1}</Text>
              {r.marcadas.includes(x.id) && <View style={{ position: "absolute", top: -4, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: c.amber }} />}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View style={[cartao(), { gap: 10 }]}>
          <Text style={{ color: c.faint, fontSize: 12.5, lineHeight: 18 }}>{meta}</Text>
          <TextoRico texto={q.enunciado} fundo={c.surface} />
          <FiguraQuestao conv={casca.conv} f={q.figura} />

          {q.tipo === "me" && (
            <View style={{ gap: 8 }}>
              {q.alternativas?.map((a, i) => {
                const estado = estadoDe(i);
                return <Alternativa key={i} letra={LETRAS[i]} texto={a} estado={estado} onPress={conf ? undefined : () => responder(i)}
                                    porque={estado === "certa" || estado === "errada" ? conf?.por_alternativa?.[i] : undefined} />;
              })}
            </View>
          )}
          {q.tipo === "vf" && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <BotaoVF rotulo="Verdadeiro" estado={estadoDe(true)} onPress={() => responder(true)} />
              <BotaoVF rotulo="Falso" estado={estadoDe(false)} onPress={() => responder(false)} />
            </View>
          )}
          {q.tipo === "disc" && (conf ? (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.raised, padding: 12 }}>
              <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 21 }}>{String(r.respostas[q.id] ?? "")}</Text>
            </View>
          ) : (
            <Area valor={String(r.respostas[q.id] ?? "")} onMuda={responder} placeholder="Sua resposta" linhas={6} />
          ))}

          {conf && (
            // a correção na hora do modo treino: o porquê (e, na discursiva, a resposta esperada; a nota sai no fim)
            <Caixinha rotulo={conf.certa === true ? "CERTA" : conf.certa === false ? "ERRADA" : "RESPOSTA ESPERADA"}
                      cor={conf.certa === true ? c.ok : conf.certa === false ? c.err : c.faint}>
              {!!conf.resposta_modelo && <TextoRico texto={conf.resposta_modelo} fundo={c.raised} />}
              {!!conf.rubrica?.length && (
                <View style={{ gap: 2 }}>
                  {conf.rubrica.map((x) => <Text key={x.criterio} style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }}>· {x.criterio} ({nota(x.pontos)} pt)</Text>)}
                </View>
              )}
              {!!conf.explicacao && q.tipo !== "disc" && <TextoRico texto={conf.explicacao} fundo={c.raised} />}
              {!!conf.pagina && <Text style={{ color: c.faint, fontSize: 12 }}>Material: {conf.pagina}</Text>}
            </Caixinha>
          )}
          {treino && !conf && (
            <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
              <ConversaDuvida key={q.id} casca={casca} fio={`dica:${prova.message_id}:${q.id}`} dica compacta />
            </View>
          )}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: Math.max(inset.bottom, 10), gap: 8, borderTopWidth: 1, borderTopColor: c.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <BotaoIcone lado={40} fundo="transparent" borda={c.line} desabilitado={r.atual === 0} onPress={() => ir(r.atual - 1)}><ArrowLeft size={18} color={c.fg} /></BotaoIcone>
          <Botao flex altura={40} rotulo={marcada ? "Marcada para revisar" : "Marcar para revisar"} icone={<Pin size={14} color={marcada ? c.amber : c.fg} />}
                 cor={marcada ? c.amber : undefined} estilo={marcada && { borderColor: c.amberLine }} onPress={marcar} />
          <BotaoIcone lado={40} fundo="transparent" borda={c.line} desabilitado={r.atual >= qs.length - 1} onPress={() => ir(r.atual + 1)}><ArrowRight size={18} color={c.fg} /></BotaoIcone>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {treino && (
            <Botao primario flex altura={44} rotulo={conf ? "Conferida" : conferindo ? "Conferindo…" : "Conferir"}
                   icone={conferindo ? <ActivityIndicator size="small" color={c.accentFg} /> : <Check size={15} color={c.accentFg} />}
                   desabilitado={!respondida || !!conf || conferindo} onPress={conferir} />
          )}
          <Botao primario={!treino} flex altura={44} rotulo={entregando ? "Entregando…" : treino ? "Terminar o treino" : "Entregar"}
                 icone={entregando ? <ActivityIndicator size="small" color={treino ? c.fg : c.accentFg} /> : treino ? undefined : <Check size={15} color={c.accentFg} />}
                 desabilitado={entregando} onPress={pedirEntrega} />
        </View>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ resultado

function QuestaoCorrigida({ casca, q, n, t }: { casca: Casca; q: EstudosQuestao; n: number; t: EstudosTentativa }) {
  const cq = t.correcao[q.id];
  const fio = `questao:${t.message_id}:${q.id}`;
  const feitas = casca.p?.duvidas?.[fio] ?? 0;
  const [aberta, setAberta] = useState(false);
  const sugestoes = [cq?.certa === true ? "Por que essa é a certa?" : "Por que a minha está errada?",
    "Explique de outro jeito", "Me dê um exemplo parecido", "Acho que o gabarito está errado"];
  const [glifo, cor, fundo] = cq?.pendente ? ["…", c.info, c.accentSoft] : cq?.certa === true ? ["✓", c.ok, c.okSoft]
    : cq?.certa === null ? ["½", c.amber, c.warnSoft] : ["✕", c.err, c.errSoft];
  const meta = [TIPO_CURTO[q.tipo], q.topico, DIFICULDADE[q.dificuldade] ?? q.dificuldade].filter(Boolean).join(" · ");
  return (
    <View style={[cartao(), { gap: 10 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: fundo, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: cor, fontFamily: mono, fontSize: 13, fontWeight: "600" }}>{glifo}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.fg2, fontSize: 13.5, fontWeight: "600" }}>Questão {n}</Text>
          <Text style={{ color: c.faint, fontSize: 12 }} numberOfLines={1}>{meta}</Text>
        </View>
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{nota(cq?.pontos ?? 0)}/{nota(q.pontos)}</Text>
      </View>
      <TextoRico texto={q.enunciado} fundo={c.surface} />
      <FiguraQuestao conv={casca.conv} f={q.figura} />

      {q.tipo === "me" && (
        <View style={{ gap: 8 }}>
          {q.alternativas?.map((a, i) => {
            const certa = i === q.correta, minha = i === cq?.resposta;
            return (
              <Alternativa key={i} letra={LETRAS[i]} texto={a} estado={certa ? "certa" : minha ? "errada" : "neutra"} porque={q.por_alternativa?.[i]}
                           direita={(certa || minha) ? (
                             <View style={{ alignItems: "flex-end", gap: 2, paddingTop: 5 }}>
                               {certa && <Text style={{ color: c.ok, fontSize: 11 }}>gabarito</Text>}
                               {minha && <Text style={{ color: certa ? c.ok : c.err, fontSize: 11 }}>sua resposta</Text>}
                             </View>
                           ) : undefined} />
            );
          })}
          {cq?.resposta === null && <Text style={{ color: c.faint, fontSize: 12.5 }}>Você não respondeu esta.</Text>}
        </View>
      )}

      {q.tipo === "vf" && (
        <Text style={{ fontSize: 14, lineHeight: 20 }}>
          <Text style={{ color: c.muted }}>Sua resposta: </Text>
          <Text style={{ color: cq?.certa ? c.ok : c.err }}>{cq?.resposta === null ? "em branco" : cq?.resposta ? "Verdadeiro" : "Falso"}</Text>
          <Text style={{ color: c.muted }}> · Gabarito: </Text>
          <Text style={{ color: c.fg }}>{q.correta ? "Verdadeiro" : "Falso"}</Text>
        </Text>
      )}

      {q.tipo === "disc" && (
        <View style={{ gap: 8 }}>
          <Caixinha rotulo="SUA RESPOSTA">
            <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 21 }}>{String(cq?.resposta || "") || "Em branco."}</Text>
          </Caixinha>
          {!!cq?.feedback && <Text style={{ color: c.muted, fontSize: 13.5, lineHeight: 20 }}>{cq.feedback}</Text>}
          {!!cq?.criterios?.length && (
            <View style={{ gap: 3 }}>
              {cq.criterios.map((x) => (
                <View key={x.criterio} style={{ flexDirection: "row", gap: 8 }}>
                  <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12, lineHeight: 18, minWidth: 44 }}>{nota(x.pontos)}/{nota(x.max)}</Text>
                  <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18, flex: 1 }}>{x.criterio}</Text>
                </View>
              ))}
            </View>
          )}
          {!!q.resposta_modelo && <Recolhivel titulo="Resposta esperada"><TextoRico texto={q.resposta_modelo} fundo={c.surface} /></Recolhivel>}
        </View>
      )}

      {!!q.explicacao && q.tipo !== "disc" && (
        <Caixinha rotulo="POR QUÊ">
          <TextoRico texto={q.explicacao} fundo={c.raised} />
          {(!!q.pagina || q.verificada === false) && (
            <Text style={{ color: c.faint, fontSize: 12 }}>
              {[q.pagina ? `Material: ${q.pagina}` : "", q.verificada === false ? "gabarito não conferido pelo verificador" : ""].filter(Boolean).join(" · ")}
            </Text>
          )}
        </Caixinha>
      )}

      <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10, gap: 10 }}>
        <Botao altura={36} estilo={{ alignSelf: "flex-start" }} icone={<Bubble size={14} color={c.fg} />} onPress={() => setAberta((v) => !v)}
               rotulo={aberta ? "Fechar a conversa" : feitas ? `Perguntar sobre esta questão · ${feitas}` : "Perguntar sobre esta questão"} />
        {aberta && <ConversaDuvida casca={casca} fio={fio} questao={{ tentativa_id: t.message_id, questao_id: q.id }} sugestoes={sugestoes} compacta />}
      </View>
    </View>
  );
}

function Resultado({ casca, t, corrigindo, onVoltar, onRefazer, onParar }: {
  casca: Casca; t: EstudosTentativa; corrigindo: EstudosTentativa | null; onVoltar: () => void; onRefazer: () => void; onParar: () => void;
}) {
  const [filtro, setFiltro] = useState<"todas" | "erradas" | "certas">("todas");
  const emCorrecao = t.status === "rodando" || t.status === "aguardando";
  const qs = t.questoes.filter((q) => {
    const cq = t.correcao[q.id];
    return filtro === "todas" || (filtro === "certas" ? cq?.certa === true : cq?.certa !== true);
  });
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
      {t.status === "aguardando" ? <AguardandoClaude texto="As discursivas vão ser corrigidas pelo Claude." onCancelar={onParar} />
       : corrigindo ? <Corrigindo t={corrigindo} /> : null}

      <View style={cartao()}>
        <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600" }}>{t.titulo}</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14 }}>
          <Text style={{ color: corNota(t.nota), fontFamily: mono, fontSize: 40, lineHeight: 44, fontWeight: "600" }}>
            {nota(t.nota)}<Text style={{ color: c.faint, fontSize: 18, fontWeight: "400" }}> / 10</Text>
          </Text>
          <View style={{ flex: 1, gap: 2, paddingBottom: 5 }}>
            <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>
              <Text style={{ color: c.fg, fontWeight: "600" }}>{t.acertos}</Text> de {t.questoes.length} certas · {nota(t.pontos)} de {nota(t.max)} pontos
            </Text>
            {!!t.segundos && <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>em {relogio(t.segundos)}{t.modo === "treino" ? " · treino" : ""}</Text>}
          </View>
        </View>
        {emCorrecao && <Text style={{ color: c.info, fontSize: 13 }}>as discursivas ainda estão sendo corrigidas</Text>}
        {!!t.aviso && <Text style={{ color: c.warn, fontSize: 13, lineHeight: 19 }}>{t.aviso}</Text>}
        {!!t.por_materia?.length && (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
            <Text style={{ color: c.faint, fontSize: 11.5 }}>Por matéria · cada erro foi para o caderno da matéria</Text>
            {t.por_materia.map((x) => {
              const pct = x.max ? x.pontos / x.max : 0;
              const nome = casca.p?.materias?.find((m) => m.id === x.materia)?.nome ?? "Matéria tirada";
              return (
                <View key={x.materia} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Text style={{ color: c.fg, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{nome}</Text>
                    <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{x.acertos}/{x.n}</Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
                    <View style={{ height: 5, borderRadius: 3, width: `${Math.round(pct * 100)}%`, backgroundColor: pct >= 0.7 ? c.ok : pct >= 0.4 ? c.amber : c.err }} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {t.por_topico.length > 1 && (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
            {t.por_topico.map((x) => {
              const pct = x.max ? x.pontos / x.max : 0;
              return (
                <View key={x.topico} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Text style={{ color: c.muted, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{x.topico}</Text>
                    <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{nota(x.pontos)}/{nota(x.max)}</Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
                    <View style={{ height: 5, borderRadius: 3, width: `${Math.round(pct * 100)}%`, backgroundColor: pct >= 0.7 ? c.ok : pct >= 0.4 ? c.amber : c.err }} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 8, paddingTop: 2 }}>
          <Botao flex altura={40} rotulo="Provas" icone={<ArrowLeft size={14} color={c.fg} />} onPress={onVoltar} />
          <Botao flex altura={40} rotulo="Refazer esta prova" icone={<Refresh size={14} color={c.fg} />} onPress={onRefazer} />
        </View>
      </View>

      <Seletor cheio altura={34} valor={filtro} onMuda={setFiltro}
               opcoes={[{ id: "todas", rotulo: "Todas" }, { id: "erradas", rotulo: "Erradas" }, { id: "certas", rotulo: "Certas" }]} />
      {qs.map((q) => <QuestaoCorrigida key={q.id} casca={casca} q={q} n={t.questoes.indexOf(q) + 1} t={t} />)}
      {!qs.length && <Text style={[s.faint, { textAlign: "center", paddingVertical: 20 }]}>{filtro === "erradas" ? "Nenhuma questão errada." : "Nenhuma questão certa."}</Text>}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ a aba

/** Aba Provas: lista de provas, gerar, fazer (prova e treino), resultado. */
export default function Provas({ casca, pendente, onPendenteUsado, geral }: { casca: Casca; pendente: ProvaPendente | null; onPendenteUsado: () => void;
                                                 geral?: boolean }) {   // geral: o simulado do "Tudo" (todas as matérias, pelo peso)
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  const [cfg, setCfg] = useState<Cfg>(PADRAO);
  const [cfgLida, setCfgLida] = useState(false);
  const [instrucoes, setInstrucoes] = useState("");
  const [folha, setFolha] = useState(false);
  const [pronta, setPronta] = useState<number | null>(null);     // faixa "prova pronta"
  const [abrindo, setAbrindo] = useState<number | null>(null);   // prova ou entrega sendo carregada
  const [entregando, setEntregando] = useState(false);
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();

  useEffect(() => { lerAjustes<Cfg>("estudos.prova", PADRAO).then((v) => { setCfg({ ...PADRAO, ...v }); setCfgLida(true); }); }, []);
  const muda = (x: Partial<Cfg>) => setCfg((a) => { const n = { ...a, ...x }; salvaAjustes("estudos.prova", n); return n; });
  // Fazendo a prova, a fila de abas some (e volta ao sair, mesmo trocando de tela no meio).
  useEffect(() => { casca.setImersao(vista.tipo === "fazer"); return () => casca.setImersao(false); }, [vista.tipo]);   // eslint-disable-line react-hooks/exhaustive-deps

  const p = casca.p;
  // no Tudo, só os simulados gerais (as provas de cada matéria ficam na matéria)
  const provas = [...(p?.provas ?? [])].filter((x) => !geral || x.config?.geral).reverse();
  const ms = p?.materias ?? [];
  const pesoDe = (m: (typeof ms)[number]) => (m.peso ?? 1) * (cfg.distribuicao === "fracos" ? 1 + 2 * (1 - (m.acerto ?? 50) / 100) : 1);
  const somaPeso = ms.reduce((t, m) => t + pesoDe(m), 0) || 1;
  const gerando = casca.exec?.tipo === "prova" ? casca.exec : null;
  const corrigindo = casca.exec?.tipo === "tentativa" ? casca.exec : null;
  // Pedido ao Claude não roda (o stream fecha na hora): quem sabe dele é a lista, até o carimbo avisar que acabou.
  const esperandoProva = gerando ? null : provas.find((x) => x.status === "aguardando") ?? null;
  const esperandoCorrecao = corrigindo ? null : provas.flatMap((x) => x.tentativas).find((x) => x.status === "aguardando") ?? null;
  const ocupado = !!casca.exec;
  const topicosDisp = p?.topicos ?? [];
  const escolhidos = cfg.topicos.filter((t) => topicosDisp.includes(t));
  const temSimulado = !!p && (p.materiais.some((m) => m.uso === "prova") || !!p.resumo?.perfil?.banca);
  const total = cfg.me + cfg.vf + cfg.disc;
  const podeGerar = total > 0 && total <= 40 && !ocupado;
  const figs = p?.figuras;
  // o teto: as que servem mais as ainda não olhadas (nada olhado = as recortadas; tudo olhado = as úteis)
  const maxFiguras = Math.min(total, figs ? figs.uteis + figs.detectadas - figs.olhadas : 0);
  const comFigura = Math.min(cfg.figuras ?? 0, maxFiguras);

  async function gerar(extra?: ProvaPendente) {
    if (ocupado) return toast("Espere terminar o que está rodando.");
    if (!total) return toast("Escolha pelo menos uma questão.");
    if (total > 40) return toast("No máximo 40 questões por prova.");
    if (!casca.modelo) return toast("Escolha um modelo em Modelos (ou no chat) antes.");
    setFolha(false);
    setPronta(null);
    const config = geral
      // os pontos fracos pedidos no Tudo viram a distribuição "fracos" do simulado geral
      ? { ...cfg, figuras: 0, topicos: [], estilo: false, geral: true, distribuicao: extra ? "fracos" : (cfg.distribuicao ?? "peso"),
          instrucoes: (extra?.instrucoes ?? instrucoes).trim() }
      : { ...cfg, figuras: comFigura, topicos: extra?.topicos ?? escolhidos, instrucoes: (extra?.instrucoes ?? instrucoes).trim() };
    try {
      const id = await casca.garante();
      const u: EstudosProva | null = await casca.segue(`/estudos/${id}/prova`, { config, ...casca.modelo });
      if (u?.status === "pronto") setPronta(u.message_id);
      if (u) setInstrucoes("");   // falhou antes de começar: o pedido fica no campo para tentar de novo
    } catch (e: any) { casca.erro(e.message); }
  }

  // A prova dos pontos fracos pedida no Desempenho: gera uma vez, com os tópicos de lá (depois de ler a config guardada).
  useEffect(() => {
    if (!pendente || !cfgLida) return;
    gerar(pendente);
    onPendenteUsado();
  }, [pendente, cfgLida]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function fazer(provaId: number, treino = false) {
    setAbrindo(provaId);
    try {
      const pr = await api.get<EstudosProva>(`/estudos/execucao/${provaId}`);
      if (!pr.questoes.length) return casca.erro("Esta prova não tem questões.");
      setPronta(null);
      // refazer uma prova já entregue: a tela mostra de novo sem gabarito (as respostas começam do zero)
      setVista({ tipo: "fazer", treino, prova: { ...pr, questoes: pr.questoes.map(({ id, tipo, enunciado, pontos, topico, dificuldade, alternativas, figura }) =>
        ({ id, tipo, enunciado, pontos, topico, dificuldade, alternativas, figura })) } });
    } catch (e: any) { casca.erro(e.message); } finally { setAbrindo(null); }
  }

  async function verResultado(tid: number) {
    setAbrindo(tid);
    try { setVista({ tipo: "resultado", t: await api.get<EstudosTentativa>(`/estudos/execucao/${tid}`) }); }
    catch (e: any) { casca.erro(e.message); } finally { setAbrindo(null); }
  }

  async function entregar(prova: EstudosProva, respostas: Record<string, Resposta>, segundos: number, treino: boolean) {
    setEntregando(true);
    try {
      const t: EstudosTentativa | null = await casca.segue(`/estudos/prova/${prova.message_id}/entregar`,
        { respostas, segundos, modo: treino ? "treino" : "prova", ...(casca.modelo ?? {}) });
      if (!t) return;   // deu erro (a casca mostra): as respostas não se perdem, a prova continua aberta
      RASCUNHOS.delete(chaveRascunho(prova.message_id, treino));
      setVista((v) => (v.tipo === "fazer" && v.prova.message_id === prova.message_id) || (v.tipo === "resultado" && v.t.message_id === t.message_id)
        ? { tipo: "resultado", t } : v);
    } finally { setEntregando(false); }
  }

  // A correção que roda (aqui ou no PC) abre e atualiza o resultado conforme as discursivas saem.
  useEffect(() => {
    if (!corrigindo) return;
    setVista((v) => {
      if (v.tipo === "fazer" && entregando && corrigindo.prova_id === v.prova.message_id) return { tipo: "resultado", t: corrigindo };
      if (v.tipo === "resultado" && v.t.message_id === corrigindo.message_id && v.t !== corrigindo) return { tipo: "resultado", t: corrigindo };
      return v;
    });
  }, [corrigindo, entregando]);
  // Correção pendente que terminou (inclusive pelo Claude, que só o carimbo avisa): relê o resultado.
  const aberta = vista.tipo === "resultado" ? vista.t : null;
  useEffect(() => {
    if (aberta && !corrigindo && (aberta.status === "rodando" || aberta.status === "aguardando")) verResultado(aberta.message_id);
  }, [corrigindo, casca.carimbo]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function parar(id: number) {
    try { await api.post(`/estudos/execucao/${id}/cancelar`); } catch (e: any) { casca.erro(e.message); }
    await casca.recarrega();
  }

  function apagar(x: EstudosProvaResumo) {
    pergunta("Apagar esta prova?", `“${x.titulo}” e as entregas dela somem do estudo.`, [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Apagar", estilo: "perigo", acao: async () => {
        try {
          await api.del(`/estudos/prova/${x.message_id}`);
          RASCUNHOS.delete(chaveRascunho(x.message_id, false));
          RASCUNHOS.delete(chaveRascunho(x.message_id, true));
          await casca.recarrega();
        } catch (e: any) { casca.erro(e.message); }
      } },
    ]);
  }

  if (vista.tipo === "fazer")
    return <FazerProva key={chaveRascunho(vista.prova.message_id, vista.treino)} casca={casca} prova={vista.prova} treino={vista.treino} entregando={entregando}
                       onEntregar={(r, seg) => entregar(vista.prova, r, seg, vista.treino)} onSair={() => setVista({ tipo: "lista" })} />;
  if (vista.tipo === "resultado")
    return <Resultado casca={casca} t={vista.t} corrigindo={corrigindo?.message_id === vista.t.message_id ? corrigindo : null}
                      onVoltar={() => setVista({ tipo: "lista" })} onRefazer={() => fazer(vista.t.prova_id)} onParar={() => parar(vista.t.message_id)} />;

  const semBase = !!p && !p.resumo && !p.materiais.length;
  const dificuldade = DIFICULDADES.find((d) => d.id === cfg.dificuldade) ?? DIFICULDADES[0];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {geral && !provas.length && !gerando && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
            <Prancheta size={32} color={c.muted} />
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600" }}>Simulado geral</Text>
            <Text style={[s.muted, { textAlign: "center", lineHeight: 19 }]}>
              Questões de todas as matérias do objetivo, na proporção do peso de cada uma (ou do peso vezes o que falta acertar). Na
              entrega, a nota sai por matéria e cada erro vai para o caderno da matéria. Matéria sem resumo nem material fica de fora.
            </Text>
          </View>
        )}
        {!geral && !provas.length && !gerando && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
            <Prancheta size={32} color={c.muted} />
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600" }}>Provas</Text>
            <Text style={[s.muted, { textAlign: "center", lineHeight: 19 }]}>
              Uma prova do seu material, com nota e o porquê de cada questão. Escolha quantas questões de cada tipo e toque em gerar:
              a IA escreve as questões a partir do resumo e do material, confere o gabarito resolvendo cada uma sem ver a resposta
              e deixa pronta a explicação de cada alternativa para depois da entrega.{semBase ? " Antes, anexe material ou gere o resumo na aba Resumo." : ""}
            </Text>
          </View>
        )}

        {gerando && (gerando.status === "aguardando"
          ? <AguardandoClaude texto="O Claude vai escrever as questões e as explicações." onCancelar={() => parar(gerando.message_id)} />
          : <Gerando p={gerando} />)}
        {esperandoProva && <AguardandoClaude texto="O Claude vai escrever as questões e as explicações." onCancelar={() => parar(esperandoProva.message_id)} />}
        {corrigindo && <Corrigindo t={corrigindo} />}
        {esperandoCorrecao && <AguardandoClaude texto="As discursivas vão ser corrigidas pelo Claude." onCancelar={() => parar(esperandoCorrecao.message_id)} />}

        {pronta != null && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: LINHA.ok, backgroundColor: c.okSoft,
                         paddingVertical: 8, paddingLeft: 12, paddingRight: 8 }}>
            <Check size={15} color={c.ok} />
            <Text style={{ color: c.fg2, fontSize: 13, flex: 1 }}>Prova pronta.</Text>
            <Botao primario altura={32} rotulo="Fazer agora" desabilitado={abrindo != null} onPress={() => fazer(pronta)} />
            <Pressable hitSlop={10} onPress={() => setPronta(null)}><X size={14} color={c.faint} /></Pressable>
          </View>
        )}

        {provas.map((x) => {
          const fim = x.status !== "rodando" && x.status !== "aguardando";
          const meta = [quando(x.criado),
            x.status === "rodando" ? "gerando…" : x.status === "aguardando" ? "esperando o Claude"
              : `${x.n}${pedidas(x.config) > x.n ? ` de ${pedidas(x.config)}` : ""} ${x.n === 1 ? "questão" : "questões"}`,
            resumoCfg(x.config), x.config?.tempo ? `${x.config.tempo} min` : "", x.motor === "claude" ? "feita pelo Claude" : ""].filter(Boolean).join(" · ");
          return (
            <View key={x.message_id} style={cartao()}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600", flex: 1 }}>{x.titulo}</Text>
                {abrindo === x.message_id ? <ActivityIndicator size="small" color={c.muted} />
                  : <Pressable hitSlop={8} onPress={() => apagar(x)} accessibilityLabel="Apagar a prova e as entregas dela"><Trash size={16} color={c.faint} /></Pressable>}
              </View>
              <Text style={{ color: c.faint, fontSize: 12.5, lineHeight: 18 }}>{meta}</Text>
              {fim && x.status !== "pronto" && <Text style={{ color: x.status === "erro" ? c.err : c.warn, fontSize: 13 }}>{x.status}</Text>}
              {x.n > 0 && fim && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Botao flex altura={40} rotulo="Treinar" desabilitado={abrindo != null} onPress={() => fazer(x.message_id, true)} />
                  <Botao flex altura={40} primario={!x.tentativas.length} rotulo={x.tentativas.length ? "Refazer" : "Fazer a prova"}
                         icone={x.tentativas.length ? <Refresh size={14} color={c.fg} /> : undefined} desabilitado={abrindo != null} onPress={() => fazer(x.message_id)} />
                </View>
              )}
              {!!x.tentativas.length && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
                  {x.tentativas.map((t, i) => (
                    <Pressable key={t.message_id} onPress={() => verResultado(t.message_id)} disabled={abrindo != null} accessibilityLabel="Ver a correção e as explicações"
                               style={({ pressed }) => ({ borderRadius: 8, borderWidth: 1, borderColor: c.line, paddingHorizontal: 10, paddingVertical: 6,
                                                          backgroundColor: pressed ? c.raised : "transparent", opacity: abrindo === t.message_id ? 0.5 : 1 })}>
                      <Text style={{ fontSize: 12 }}>
                        <Text style={{ color: c.faint }}>{i + 1}ª{t.modo === "treino" ? " treino" : ""} · </Text>
                        <Text style={{ color: corNota(t.nota), fontFamily: mono, fontWeight: "600" }}>{nota(t.nota)}</Text>
                        <Text style={{ color: c.faint, fontFamily: mono }}>/10</Text>
                        <Text style={{ color: c.faint }}> · {quando(t.criado)}{t.status !== "pronto" ? ` · ${t.status}` : ""}</Text>
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 110, paddingHorizontal: 8, paddingTop: 6 }} value={instrucoes} onChangeText={setInstrucoes} multiline
                     placeholder="Algo específico para esta prova? (opcional)" placeholderTextColor={c.faint} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={plural(total, "questão", "questões")} icone={<Prancheta size={14} color={total > 40 ? c.err : c.muted} />} cor={total > 40 ? c.err : undefined}
                    onPress={() => setFolha(true)} />
              <Chip rotulo={dificuldade.rotulo} onPress={() => setFolha(true)} />
              {geral ? <Chip rotulo={cfg.distribuicao === "fracos" ? "Mais dos fracos" : "Pelo peso"} onPress={() => muda({ distribuicao: cfg.distribuicao === "fracos" ? "peso" : "fracos" })} />
                : <Chip rotulo={escolhidos.length ? `Tópicos ${escolhidos.length}/${topicosDisp.length}` : "Tópicos"} ativo={!!escolhidos.length} onPress={() => setFolha(true)} />}
              <Chip rotulo={cfg.tempo ? `${cfg.tempo} min` : "Sem relógio"} icone={<Clock size={14} color={c.muted} />} onPress={() => setFolha(true)} />
              {!geral && temSimulado && <Chip rotulo="Simulado" ativo={cfg.estilo} icone={<Check size={14} color={cfg.estilo ? c.accentText : c.muted} />} onPress={() => muda({ estilo: !cfg.estilo })} />}
            </ScrollView>
            {gerando?.status === "rodando" ? (
              <Pressable onPress={() => parar(gerando.message_id)} accessibilityLabel="Parar"
                         style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: c.accentFg }} />
              </Pressable>
            ) : <BotaoEnviar pode={podeGerar} onPress={() => gerar()} />}
          </View>
        </View>
      </View>

      <Folha aberta={folha} titulo={geral ? "Simulado geral" : "Nova prova"} onFecha={() => setFolha(false)}>
        {geral && !!ms.length && (
          <View style={{ gap: 8 }}>
            <Text style={s.secao2}>QUANTAS DE CADA MATÉRIA</Text>
            <Seletor cheio valor={cfg.distribuicao ?? "peso"} onMuda={(distribuicao) => muda({ distribuicao })}
                     opcoes={[{ id: "peso", rotulo: "Pelo peso" }, { id: "fracos", rotulo: "Mais dos fracos" }]} />
            {ms.map((m) => (
              <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: c.muted, fontSize: 13, flex: 1 }} numberOfLines={1}>{m.nome}</Text>
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>≈ {Math.round((pesoDe(m) / somaPeso) * total)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={{ gap: 12 }}>
          <Text style={s.secao2}>QUESTÕES</Text>
          <LinhaAjuste rotulo="Múltipla escolha"><Contador valor={cfg.me} min={0} max={40} onMuda={(me) => muda({ me })} /></LinhaAjuste>
          <LinhaAjuste rotulo="Verdadeiro ou falso"><Contador valor={cfg.vf} min={0} max={40} onMuda={(vf) => muda({ vf })} /></LinhaAjuste>
          <LinhaAjuste rotulo="Discursivas" sub="corrigidas pela IA, com rubrica"><Contador valor={cfg.disc} min={0} max={20} onMuda={(disc) => muda({ disc })} /></LinhaAjuste>
          <Text style={[s.faint, { fontSize: 12.5, color: total > 40 ? c.err : c.faint }]}>{plural(total, "questão", "questões")} no total · no máximo 40</Text>
          {!geral && maxFiguras > 0 && (
            <LinhaAjuste rotulo="Com figura do PDF" sub={`gráfico, diagrama, tabela · ${figs!.olhadas ? `${figs!.uteis} servem` : `${figs!.detectadas} recortadas`} · precisa de modelo que enxerga`}>
              <Contador valor={comFigura} min={0} max={maxFiguras} onMuda={(figuras) => muda({ figuras })} />
            </LinhaAjuste>
          )}
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>DIFICULDADE</Text>
          <Seletor cheio valor={cfg.dificuldade} opcoes={DIFICULDADES} onMuda={(dificuldade) => muda({ dificuldade })} />
          <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>{dificuldade.dica}</Text>
        </View>
        {!geral && temSimulado && (
          <Opcao rotulo="Estilo do simulado" dica="Imita o jeito das provas anexadas (banca, formato, enunciado)." valor={cfg.estilo} onMuda={(estilo) => muda({ estilo })} />
        )}
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>TEMPO DE PROVA</Text>
          <LinhaAjuste rotulo="Cronômetro" sub="acabou o tempo, entrega sozinha">
            <Contador valor={cfg.tempo} min={0} max={600} passo={5} fmt={(n) => (n ? `${n} min` : "sem")} onMuda={(tempo) => muda({ tempo })} />
          </LinhaAjuste>
        </View>
        {!geral && <View style={{ gap: 8 }}>
          <Text style={s.secao2}>TÓPICOS</Text>
          {topicosDisp.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {topicosDisp.map((t) => {
                const on = escolhidos.includes(t);
                return (
                  // pílula própria: a Chip corta o rótulo em 14 letras, e o nome do tópico precisa ser lido inteiro
                  <Pressable key={t} onPress={() => muda({ topicos: on ? escolhidos.filter((x) => x !== t) : [...escolhidos, t] })}
                             style={{ height: 32, borderRadius: 999, paddingHorizontal: 11, justifyContent: "center", borderWidth: 1, maxWidth: "100%",
                                      borderColor: on ? c.accentLine : "transparent", backgroundColor: on ? c.accentSoft : c.raised }}>
                    <Text style={{ color: on ? c.accentText : c.muted, fontSize: 13 }} numberOfLines={1}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : <Text style={[s.faint, { fontSize: 12.5 }]}>Gere o resumo para escolher por tópico.</Text>}
          {!!topicosDisp.length && <Text style={[s.faint, { fontSize: 12.5 }]}>Nenhum marcado = todos.</Text>}
        </View>}
        <View style={{ gap: 8 }}>
          <Text style={s.secao2}>PEDIDO</Text>
          <Area valor={instrucoes} onMuda={setInstrucoes} placeholder="Algo específico para esta prova? (opcional — ex.: mais questões de cálculo)" linhas={2} />
        </View>
        <Botao primario altura={44} rotulo={geral ? "Gerar o simulado geral" : "Gerar prova"} desabilitado={!podeGerar} onPress={() => gerar()} />
      </Folha>
    </View>
  );
}
