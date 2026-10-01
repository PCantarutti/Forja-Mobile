import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "./Texto";
import { api, cancelado, streamSSE } from "./api";
import { TextoRico } from "./Formula";
import { Bubble, Livro } from "./icones";
import { BotaoEnviar } from "./Imagens";
import Markdown from "./Markdown";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Botao, Pulsa, toast } from "./ui";
import { type Casca, type EstudosDuvidaMsg, type Pendente, type Status, PEDIDO_CLAUDE } from "./estudosTipos";

// Dúvidas da tela Estudos (EstudosDuvidas.tsx do desktop): uma conversa por fio — a geral da matéria, a de uma
// questão corrigida ("questao:<tentativa>:<qid>") e as dicas do treino ("dica:<prova>:<qid>"). As mesmas rotas
// do PC; o carimbo da casca traz o que o outro aparelho (ou o Claude, pelo MCP) perguntou e respondeu.

const SUGESTOES_INICIAIS = ["Quais são os pontos que mais caem?", "Me explique o tópico mais difícil", "Faça um resumo de 5 linhas"];
const MAX_DICAS = 3;
const CARTAO = { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 } as const;

/** O retrato de uma resposta que o SSE manda a cada 0,3 s (estudos.estado no backend). */
type Retrato = { message_id?: number; texto?: string; status?: Status; aviso?: string; erro?: string; stats?: { escritor?: string } };
const atualiza = (m: EstudosDuvidaMsg, ev: Retrato): EstudosDuvidaMsg =>
  ({ ...m, texto: ev.texto ?? m.texto, status: ev.status ?? m.status, aviso: ev.aviso ?? m.aviso, modelo: ev.stats?.escritor || m.modelo });

type Props = {
  casca: Casca;
  fio: string;
  questao?: { tentativa_id: number; questao_id: string };
  sugestoes?: string[];
  pendente?: Pendente | null;   // pergunta que chegou de fora (trecho marcado no resumo): vai sozinha uma vez
  onPendenteUsado?: () => void;
  compacta?: boolean;           // dentro do cartão da questão: caixa pequena, sem rolagem própria
  dica?: boolean;               // modo treino: só o botão "Pedir uma dica" (até 3), sem as perguntas na tela
};

/** O ícone da lâmpada do desktop (icons.tsx), só desta tela. */
const Lampada = ({ size = 14, color = c.fg }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" />
  </Svg>
);

/** O estado de um fio: carrega, acompanha a resposta viva, envia, para. Separado do desenho porque a aba e o
 *  cartão da questão desenham diferente a mesma conversa. */
function useFio({ casca, fio, questao, pendente, onPendenteUsado }: Props) {
  const [msgs, setMsgs] = useState<EstudosDuvidaMsg[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);   // o valor de agora dentro das callbacks (o estado atrasa um render)
  const corte = useRef<AbortController | null>(null);
  const ouvindo = useRef(0);
  const cascaRef = useRef(casca);
  cascaRef.current = casca;            // modelo, erro() e recarrega() mais novos sem reentrar nos efeitos
  const questaoRef = useRef(questao);
  questaoRef.current = questao;

  const carregar = useCallback(async () => {
    if (casca.conv == null) return setMsgs([]);
    try {
      const lista = await api.get<EstudosDuvidaMsg[]>(`/estudos/${casca.conv}/duvidas?fio=${encodeURIComponent(fio)}`);
      // No meio de um envio a lista velha apagaria as bolhas otimistas; o fim do envio recarrega.
      if (!enviandoRef.current) setMsgs(lista);
    } catch (e: any) {
      cascaRef.current.erro(e.message);
    }
  }, [casca.conv, fio]);

  /** Resposta em andamento (aberta no meio, ou disparada no PC): acompanha pelo SSE. */
  const ouvir = useCallback(async (id: number) => {
    if (ouvindo.current === id) return;
    ouvindo.current = id;
    corte.current?.abort();
    const ac = (corte.current = new AbortController());
    let inteira = false;
    try {
      await streamSSE(`/estudos/execucao/${id}/stream`, (ev: Retrato) => {
        if (ev.erro || ac.signal.aborted) return;
        setMsgs((ms) => ms.map((m) => (m.id === id ? atualiza(m, ev) : m)));
      }, ac.signal);
      inteira = true;
    } catch {
      /* caiu a conexão: o carimbo (ou a volta do app) traz o resto */
    } finally {
      if (ouvindo.current === id) ouvindo.current = 0;
      if (inteira && !ac.signal.aborted) carregar();   // o nome do modelo e o status final vêm do banco
    }
  }, [carregar]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => () => corte.current?.abort(), []);
  // Outro aparelho perguntou, ou o Claude respondeu pelo MCP: recarrega, fora do meio de uma resposta.
  const primeiroCarimbo = useRef(true);
  useEffect(() => {
    if (primeiroCarimbo.current) { primeiroCarimbo.current = false; return; }
    if (!enviandoRef.current && !ouvindo.current) carregar();
  }, [casca.carimbo]);   // eslint-disable-line react-hooks/exhaustive-deps
  // O SSE morre com o app suspenso: ao voltar, recarrega e a resposta viva volta a ser acompanhada.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active" && !enviandoRef.current) carregar(); });
    return () => sub.remove();
  }, [carregar]);
  useEffect(() => {
    const viva = msgs.find((m) => m.role === "assistant" && m.status === "rodando");
    if (viva && viva.id > 0 && !enviando) ouvir(viva.id);
  }, [msgs, enviando, ouvir]);

  const enviar = useCallback(async (pergunta: string, trecho = "") => {
    pergunta = pergunta.trim();
    if (!pergunta || enviandoRef.current) return;
    const k = cascaRef.current;
    if (!k.modelo) return toast("Escolha um modelo em Modelos (ou no chat) antes.");
    enviandoRef.current = true;
    setEnviando(true);
    setTexto("");
    const temp = -Date.now();
    let idResposta = temp - 1;   // vira o id real no primeiro retrato: o Parar precisa dele
    setMsgs((ms) => [...ms,
      { id: temp, role: "user", texto: pergunta, status: "pronto", trecho, motor: "", aviso: "", modelo: "", criado: "" },
      { id: idResposta, role: "assistant", texto: "", status: "rodando", trecho: "", motor: "forja", aviso: "", modelo: "", criado: "" }]);
    corte.current?.abort();
    const ac = (corte.current = new AbortController());
    try {
      const conv = k.conv ?? (await k.garante());
      await streamSSE(`/estudos/${conv}/duvida`, (ev: Retrato) => {
        if (ac.signal.aborted) return;
        if (ev.erro) return cascaRef.current.erro(ev.erro);
        const novo = typeof ev.message_id === "number" ? ev.message_id : idResposta;
        const velho = idResposta;
        setMsgs((ms) => ms.map((m) => (m.id === velho ? atualiza({ ...m, id: novo }, ev) : m)));
        idResposta = novo;
      }, ac.signal, { pergunta, trecho, fio, questao: questaoRef.current ?? null, provider: k.modelo.provider, model: k.modelo.model });
    } catch (e: any) {
      if (!ac.signal.aborted && !cancelado(e)) cascaRef.current.erro(e.message);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
      if (!ac.signal.aborted) await carregar();
      cascaRef.current.recarrega();   // a contagem de dúvidas do projeto mudou
    }
  }, [fio, carregar]);

  // Pergunta que veio de fora (o "explicar de outro jeito" do resumo): vai uma vez só.
  useEffect(() => {
    if (pendente && !enviandoRef.current) {
      enviar(pendente.pergunta, pendente.trecho);
      onPendenteUsado?.();
    }
  }, [pendente]);   // eslint-disable-line react-hooks/exhaustive-deps

  const parar = useCallback(async () => {
    const viva = [...msgs].reverse().find((m) => m.role === "assistant" && (m.status === "rodando" || m.status === "aguardando"));
    if (viva && viva.id > 0) await api.post(`/estudos/execucao/${viva.id}/cancelar`).catch(() => {});
    corte.current?.abort();
    enviandoRef.current = false;   // o finally do envio ainda não rodou; sem isto a lista nova seria ignorada
    carregar();
  }, [msgs, carregar]);

  const respondendo = enviando || msgs.some((m) => m.role === "assistant" && (m.status === "rodando" || m.status === "aguardando"));
  return { msgs, texto, setTexto, enviar, parar, respondendo };
}

/** Uma mensagem: a pergunta numa bolha à direita, a resposta solta na coluna (como no desktop). */
function Mensagem({ m, n, fundo, dica }: { m: EstudosDuvidaMsg; n: number; fundo: string; dica?: boolean }) {
  if (m.role === "user")
    return (
      <View style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: c.raised, borderRadius: 20, borderBottomRightRadius: 6,
                     paddingHorizontal: 14, paddingVertical: 9, gap: 5 }}>
        {!!m.trecho && (
          <View style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: 8 }}>
            <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18, fontStyle: "italic" }} numberOfLines={6}>«{m.trecho}»</Text>
          </View>
        )}
        <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 21 }} selectable>{m.texto}</Text>
      </View>
    );
  return (
    <View style={{ gap: 6 }}>
      {dica && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Lampada size={12} color={c.faint} />
          <Text style={s.secao2}>DICA {n}</Text>
        </View>
      )}
      {m.status === "aguardando" ? (
        <Text style={[s.muted, { lineHeight: 19 }]}>
          Esperando o Claude — no Claude Code conectado ao Forja, peça: <Text style={{ color: c.fg }}>“{PEDIDO_CLAUDE}”</Text>
        </Text>
      ) : m.texto ? (
        // Enquanto chega, o Markdown nativo: a WebView das fórmulas recarregaria a cada retrato (0,3 s).
        m.status === "rodando" ? <Markdown texto={m.texto} /> : <TextoRico texto={m.texto} fundo={fundo} />
      ) : m.status === "rodando" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Pulsa cor={c.info} />
          <Text style={{ color: c.info, fontSize: 12.5 }}>pensando…</Text>
        </View>
      ) : null}
      {!!m.aviso && <Text style={{ color: c.warn, fontSize: 12.5, lineHeight: 18 }}>{m.aviso}</Text>}
      {!!m.modelo && m.status === "pronto" && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }}>{m.modelo}</Text>}
    </View>
  );
}

/** Perguntas prontas (pílulas que quebram linha; o Chip corta em 14 letras, pequeno demais para uma frase). */
function Sugestoes({ itens, onPress }: { itens: string[]; onPress: (t: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {itens.map((t) => (
        <Pressable key={t} onPress={() => onPress(t)}
                   style={({ pressed }) => ({ borderRadius: 999, borderWidth: 1, borderColor: c.line, paddingHorizontal: 12, paddingVertical: 7,
                                              backgroundColor: pressed ? c.raised : "transparent" })}>
          <Text style={{ color: c.fg2, fontSize: 13 }}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** O quadrado de parar, igual ao da Pesquisa. */
const BotaoParar = ({ onPress }: { onPress: () => void }) => (
  <Pressable onPress={onPress} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
    <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: c.accentFg }} />
  </Pressable>
);

type Composer = { texto: string; setTexto: (t: string) => void; respondendo: boolean; onEnviar: () => void; onParar: () => void };

/** Dentro do cartão da questão: uma linha, Enter envia. */
function ComposerCompacto({ texto, setTexto, respondendo, onEnviar, onParar }: Composer) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg,
                   paddingLeft: 12, paddingRight: 6, paddingVertical: 5 }}>
      <TextInput style={{ flex: 1, color: c.fg, fontSize: 14.5, paddingVertical: 6 }} value={texto} onChangeText={setTexto}
                 placeholder="Pergunte sobre esta questão…" placeholderTextColor={c.faint} returnKeyType="send"
                 onSubmitEditing={() => texto.trim() && onEnviar()} />
      {respondendo ? <BotaoParar onPress={onParar} /> : <BotaoEnviar pode={!!texto.trim()} onPress={onEnviar} />}
    </View>
  );
}

/** Na aba: a caixa da Pesquisa (raio 24), presa no rodapé, sobe com o teclado. */
function ComposerGrande({ texto, setTexto, respondendo, onEnviar, onParar }: Composer) {
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
      <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
        <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={texto} onChangeText={setTexto} multiline
                   placeholder="Qual a sua dúvida sobre a matéria?" placeholderTextColor={c.faint} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ flex: 1, color: c.faint, fontSize: 12, lineHeight: 16, paddingLeft: 8 }} numberOfLines={2}>
            Dica: no resumo, marque um trecho para pedir outra explicação.
          </Text>
          {respondendo ? <BotaoParar onPress={onParar} /> : <BotaoEnviar pode={!!texto.trim()} onPress={onEnviar} />}
        </View>
      </View>
    </View>
  );
}

/** A conversa desenhada: no cartão (compacta) é uma coluna que o pai rola; na aba, rola sozinha e segue o fim. */
function Conversa(props: Props & { cabecalho?: ReactNode }) {
  const f = useFio(props);
  const rolagem = useRef<ScrollView>(null);
  const noFim = useRef(true);   // só segue o fim se o usuário não subiu para reler
  const fundo = props.compacta ? c.surface : c.bg;
  const dadas = f.msgs.filter((m) => m.role === "assistant");
  const envia = (t: string) => { noFim.current = true; f.enviar(t); };
  const aoRolar = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    noFim.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
  };
  // Mensagem nova, ou o teclado abriu e a área encolheu: segue o fim (onLayout pega a mudança de tamanho).
  const segueFim = () => { if (noFim.current) rolagem.current?.scrollToEnd({ animated: false }); };

  const lista = (
    <>
      {f.msgs.map((m) => (m.role === "user" && props.dica ? null : <Mensagem key={m.id} m={m} n={dadas.indexOf(m) + 1} fundo={fundo} dica={props.dica} />))}
      {!!props.sugestoes?.length && !f.respondendo && <Sugestoes itens={props.sugestoes} onPress={envia} />}
    </>
  );
  const composer = { texto: f.texto, setTexto: f.setTexto, respondendo: f.respondendo, onEnviar: () => envia(f.texto), onParar: f.parar };

  if (props.dica)
    return (
      <View style={{ gap: 10 }}>
        {lista}
        {dadas.length < MAX_DICAS && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Botao rotulo={dadas.length ? "Outra dica" : "Pedir uma dica"} icone={<Lampada size={14} color={c.fg} />} altura={36}
                   desabilitado={f.respondendo} onPress={() => envia("Quero uma dica")} />
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{dadas.length + 1}/{MAX_DICAS}</Text>
          </View>
        )}
      </View>
    );
  if (props.compacta)
    return (
      <View style={{ gap: 10 }}>
        {lista}
        <ComposerCompacto {...composer} />
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={rolagem} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled"
                  onScroll={aoRolar} scrollEventThrottle={100} onContentSizeChange={segueFim} onLayout={segueFim}>
        {props.cabecalho}
        {lista}
      </ScrollView>
      <ComposerGrande {...composer} />
    </View>
  );
}

/** Uma conversa de dúvidas: a geral ("geral"), a de uma questão corrigida ("questao:<tentativa>:<qid>") ou
 *  as dicas do treino ("dica:<prova>:<qid>"). */
export function ConversaDuvida(props: {
  casca: Casca;
  fio: string;
  questao?: { tentativa_id: number; questao_id: string };
  sugestoes?: string[];
  pendente?: Pendente | null;
  onPendenteUsado?: () => void;
  compacta?: boolean;   // dentro do cartão da questão: caixa pequena
  dica?: boolean;       // modo treino: só o botão "Pedir uma dica" (até 3)
}) {
  return <Conversa {...props} />;
}

/** Aba Dúvidas: a conversa geral da matéria. */
export default function Duvidas({ casca, pendente, onPendenteUsado }: { casca: Casca; pendente: Pendente | null; onPendenteUsado: () => void }) {
  const p = casca.p;
  const vazia = !p?.duvidas?.geral && !pendente;
  // Sem resumo nem material o professor responde só com o que sabe: vale avisar e levar à aba Resumo.
  const semBase = casca.conv == null || (!!p && !p.resumo && !p.materiais.length);
  const cartao = (vazia || semBase) && (
    <View style={CARTAO}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Bubble size={16} color={c.muted} />
        <Text style={{ color: c.fg, fontSize: 14.5 }}>Tire dúvidas sobre a matéria.</Text>
      </View>
      <Text style={[s.muted, { lineHeight: 19 }]}>
        O professor responde com o resumo, o seu material e as páginas lidas na pesquisa. Para dúvida de uma questão, abra a
        correção na aba Provas e use “Perguntar” na própria questão. Para outra explicação de um pedaço do resumo, marque o trecho lá.
      </Text>
      {semBase && (
        <>
          <Text style={[s.muted, { lineHeight: 19 }]}>Ainda não há resumo nem material nesta conversa: por enquanto ele responde só com o que sabe.</Text>
          <Botao rotulo="Estudar um tema" icone={<Livro size={14} color={c.fg} />} altura={36} estilo={{ alignSelf: "flex-start" }}
                 onPress={() => casca.setAba("resumo")} />
        </>
      )}
    </View>
  );
  return (
    <Conversa casca={casca} fio="geral" pendente={pendente} onPendenteUsado={onPendenteUsado} cabecalho={cartao || null}
              sugestoes={vazia ? SUGESTOES_INICIAIS : undefined} />
  );
}
