import * as Clipboard from "expo-clipboard";
import { fetch } from "expo/fetch";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Texto";
import { api, base, comToken, lerAjustes, salvaAjustes } from "./api";
import { compartilhaTexto } from "./Comparar";
import { pergunta } from "./Dialogo";
import { TextoRico, temFormula } from "./Formula";
import { ArrowRight, Check, Copy, Download, Refresh, Trash, X } from "./icones";
import { c, mono, s } from "./tema";
import { Botao, Contador, Pulsa, Seletor, corta, toast } from "./ui";
import { type Casca, type EstudosFlashcards, type EstudosItemRevisao, LETRAS, PEDIDO_CLAUDE, numeros } from "./estudosTipos";

// Aba Revisão da tela Estudos (EstudosRevisao do desktop): o painel do dia, a sessão de revisão espaçada
// (caderno de erros e flashcards, um item por vez), a geração de cartões e a exportação para o Anki.
// Tudo vem de casca.p.revisao; cada ação chama casca.recarrega() para o PC ver na hora.

// As cores de estado não mudam com o tema (tema.ts ESTADOS): a mesma borda que a Pesquisa usa no "concluído".
const OK_LINHA = "rgba(95,211,154,0.5)";
const ERR_LINHA = "rgba(226,122,107,0.5)";
const cartao = (): ViewStyle => ({ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 });
/** "2026-10-03" → "03/10", sem passar pelo Date (meia-noite UTC virava o dia anterior no Brasil). */
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Texto corrido para a lista e para o diálogo: sem as marcas do markdown. */
const semMarcas = (t: string) => t.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Uma linha ou duas da lista: sem as marcas; com fórmula vai no TextoRico (que não corta linhas). */
function Resumido({ texto, cor, tamanho = 13.5 }: { texto: string; cor: string; tamanho?: number }) {
  if (temFormula(texto)) return <TextoRico texto={texto} fundo={c.surface} tamanho={tamanho} />;
  return <Text style={{ color: cor, fontSize: tamanho, lineHeight: tamanho + 5.5 }} numberOfLines={2}>{semMarcas(texto)}</Text>;
}

/** Uma alternativa da múltipla escolha: a letra num círculo; depois da resposta pinta a certa e a errada. */
function Alternativa({ letra, texto, estado, onPress }:
  { letra: string; texto: string; estado: "neutra" | "certa" | "errada" | "apagada"; onPress: () => void }) {
  const cor = estado === "certa" ? c.ok : estado === "errada" ? c.err : estado === "apagada" ? c.faint : c.muted;
  return (
    <Pressable onPress={onPress} disabled={estado !== "neutra"}
               style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1,
                 borderColor: estado === "certa" ? OK_LINHA : estado === "errada" ? ERR_LINHA : c.line,
                 backgroundColor: estado === "certa" ? c.okSoft : estado === "errada" ? c.errSoft : pressed ? c.raised : c.surface,
                 opacity: estado === "apagada" ? 0.55 : 1 })}>
      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
                     borderColor: estado === "neutra" ? c.lineStrong : cor }}>
        <Text style={{ color: cor, fontFamily: mono, fontSize: 12, fontWeight: "600" }}>{letra}</Text>
      </View>
      <View style={{ flex: 1 }}><TextoRico texto={texto} fundo={c.surface} /></View>
    </Pressable>
  );
}

/** Uma rodada de revisão: um item por vez; erro de prova se responde de novo, cartão se vira. */
function Sessao({ casca, conv, itens, onFim }: { casca: Casca; conv: number; itens: EstudosItemRevisao[]; onFim: () => void }) {
  const [i, setI] = useState(0);
  const [resposta, setResposta] = useState<number | boolean | null>(null);
  const [virado, setVirado] = useState(false);
  const [placar, setPlacar] = useState({ certas: 0, feitas: 0 });
  const [enviando, setEnviando] = useState(false);
  const inset = useSafeAreaInsets();
  const rolagem = useRef<ScrollView>(null);
  const item = itens[i];
  const q = item?.tipo === "erro" ? item.questao : null;
  const fechada = !!q && q.tipo !== "disc";
  const acertouFechada = fechada && resposta !== null ? resposta === q.correta : null;

  async function proximo(acertou: boolean, tirar = false) {
    if (!item || enviando) return;
    setEnviando(true);
    try { await api.post(`/estudos/${conv}/revisao`, { chave: item.chave, acertou, tirar }); }
    catch (e: any) { casca.erro(e.message); }
    finally { setEnviando(false); }
    if (!tirar) setPlacar((p) => ({ certas: p.certas + (acertou ? 1 : 0), feitas: p.feitas + 1 }));
    setResposta(null);
    setVirado(false);
    setI((x) => x + 1);
    rolagem.current?.scrollTo({ y: 0, animated: false });
    casca.recarrega();   // o "Revisão · N" da aba e o PC veem o item respondido na hora
  }

  // No desktop o "Tirar do caderno" explica no tooltip; aqui a explicação vai na confirmação.
  const tirar = () => pergunta("Tirar do caderno?", "Questão com defeito, ou que você já domina: não volta mais para a revisão.",
    [{ texto: "Cancelar", estilo: "cancelar" }, { texto: "Tirar", acao: () => proximo(false, true) }]);

  if (!item)
    return (
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View style={cartao()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.okSoft, alignItems: "center", justifyContent: "center" }}>
              <Check size={18} color={c.ok} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600" }}>Revisão feita: {placar.certas} de {placar.feitas} certas.</Text>
              <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>O que você errou volta amanhã; o que acertou, só daqui a alguns dias.</Text>
            </View>
          </View>
          <Botao primario altura={40} rotulo="Fechar" onPress={onFim} />
        </View>
      </ScrollView>
    );

  const rotuloResposta = acertouFechada === true ? "CERTA" : acertouFechada === false ? "ERRADA DE NOVO" : "RESPOSTA ESPERADA";
  const corResposta = acertouFechada === true ? c.ok : acertouFechada === false ? c.err : c.faint;
  const mostraResposta = resposta !== null || (q?.tipo === "disc" && virado);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 10, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12.5 }}>{i + 1} / {itens.length}</Text>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: c.raised, overflow: "hidden" }}>
            <View style={{ height: 4, borderRadius: 2, width: `${(i / itens.length) * 100}%`, backgroundColor: c.accent }} />
          </View>
          <Pressable hitSlop={10} onPress={onFim} accessibilityLabel="Parar a revisão"><X size={18} color={c.muted} /></Pressable>
        </View>
        <Text style={{ color: c.faint, fontSize: 12.5 }} numberOfLines={1}>
          {item.tipo === "erro" ? `erro da ${item.prova}` : "cartão"} · caixa {item.caixa}
        </Text>
      </View>

      <ScrollView ref={rolagem} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View style={[cartao(), { padding: 14, gap: 12 }]}>
          {!!item.topico && <Text style={s.secao2}>{item.topico.toUpperCase()}</Text>}
          {item.tipo === "cartao" ? (
            <>
              <TextoRico texto={item.frente} fundo={c.surface} />
              {virado && (
                <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 }}>
                  <TextoRico texto={item.verso} fundo={c.surface} />
                </View>
              )}
            </>
          ) : (
            <>
              <TextoRico texto={q!.enunciado} fundo={c.surface} />
              {q!.tipo === "me" && (
                <View style={{ gap: 6 }}>
                  {q!.alternativas?.map((a, k) => {
                    const certa = resposta !== null && k === q!.correta;
                    const estado = resposta === null ? "neutra" : certa ? "certa" : resposta === k ? "errada" : "apagada";
                    return <Alternativa key={k} letra={LETRAS[k]} texto={a} estado={estado} onPress={() => setResposta(k)} />;
                  })}
                </View>
              )}
              {q!.tipo === "vf" && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {([[true, "Verdadeiro"], [false, "Falso"]] as const).map(([v, nome]) => {
                    const certa = resposta !== null && v === q!.correta, minha = resposta === v;
                    return (
                      <Pressable key={nome} disabled={resposta !== null} onPress={() => setResposta(v)}
                                 style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center",
                                   borderColor: certa ? OK_LINHA : minha ? ERR_LINHA : c.line,
                                   backgroundColor: certa ? c.okSoft : minha ? c.errSoft : pressed ? c.raised : c.surface,
                                   opacity: resposta !== null && !certa && !minha ? 0.55 : 1 })}>
                        <Text style={{ color: certa ? c.ok : minha ? c.err : c.fg, fontSize: 14.5, fontWeight: certa || minha ? "600" : "400" }}>{nome}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {q!.tipo === "disc" && !virado && (
                <Text style={{ color: c.faint, fontSize: 12.5, lineHeight: 18 }}>Responda de cabeça (ou no papel) e depois veja a resposta esperada.</Text>
              )}
              {mostraResposta && (
                <View style={{ backgroundColor: c.raised, borderRadius: 12, padding: 12, gap: 6 }}>
                  <Text style={[s.secao2, { color: corResposta }]}>{rotuloResposta}</Text>
                  <TextoRico texto={(q!.tipo === "disc" ? q!.resposta_modelo : q!.explicacao) ?? ""} fundo={c.raised} />
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: Math.max(inset.bottom, 10), gap: 10 }}>
        {fechada ? (
          resposta !== null && (
            <Botao primario altura={44} rotulo="Próximo" icone={<ArrowRight size={15} color={c.accentFg} />} desabilitado={enviando}
                   onPress={() => proximo(!!acertouFechada)} />
          )
        ) : !virado ? (
          <Botao primario altura={44} rotulo={item.tipo === "cartao" ? "Virar o cartão" : "Mostrar a resposta"} onPress={() => setVirado(true)} />
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao flex altura={44} rotulo="Errei" icone={<X size={15} color={c.fg} />} desabilitado={enviando} onPress={() => proximo(false)} />
            <Botao flex primario altura={44} rotulo="Acertei" icone={<Check size={15} color={c.accentFg} />} desabilitado={enviando} onPress={() => proximo(true)} />
          </View>
        )}
        {item.tipo === "erro" && (
          <Pressable hitSlop={8} onPress={tirar} disabled={enviando} style={{ alignSelf: "center" }}>
            <Text style={{ color: c.muted, fontSize: 12.5 }}>Tirar do caderno</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** A geração de cartões ao vivo (o Sinapse do desktop, em lista): cada parte com o seu estado e os números. */
function Progresso({ f, onParar }: { f: EstudosFlashcards; onParar: () => void }) {
  const ok = f.partes.filter((p) => p.status === "ok").length;
  const marca = (st: string) => (
    <View style={{ width: 12, alignItems: "center" }}>
      {st === "gerando" ? <Pulsa cor={c.info} lado={6} /> : st === "ok" ? <Check size={12} color={c.muted} /> : st === "erro" ? <X size={12} color={c.err} />
        : <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.faint }} />}
    </View>
  );
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: c.fg, fontSize: 13.5, flex: 1 }}>Escrevendo os cartões</Text>
        <Pulsa cor={c.info} />
      </View>
      <View style={{ gap: 4 }}>
        {f.partes.map((p) => (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {marca(p.status)}
            <Text style={{ color: p.status === "gerando" ? c.info : p.status === "erro" ? c.err : p.status === "ok" ? c.muted : c.faint, fontSize: 12.5, flex: 1 }}
                  numberOfLines={1}>{p.topicos.join(", ")}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>
        {[`${ok} de ${f.partes.length} partes`, plural(f.cartoes.length, "cartão", "cartões"), numeros(f)].filter(Boolean).join(" · ")}
      </Text>
      {!!f.aviso && <Text style={{ color: c.warn, fontSize: 13 }}>{f.aviso}</Text>}
      <Botao altura={40} rotulo="Parar" icone={<X size={14} color={c.fg} />} onPress={onParar} />
    </>
  );
}

/** Uma linha das listas (caderno de erros, cartões): o texto, de onde veio e quando volta. */
function Linha({ x, primeira, onApagar }: { x: EstudosItemRevisao; primeira: boolean; onApagar?: () => void }) {
  const selo = x.dominada ? "dominado" : x.vence ? "hoje" : diaMes(x.proxima);
  const cor = x.dominada ? c.ok : x.vence ? c.amber : c.faint;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderTopWidth: primeira ? 0 : 1, borderTopColor: c.line }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Resumido texto={x.tipo === "erro" ? x.questao.enunciado : x.frente} cor={c.fg} />
        {x.tipo === "cartao" && <Resumido texto={x.verso} cor={c.muted} tamanho={12.5} />}
        <Text style={{ color: c.faint, fontSize: 12 }} numberOfLines={1}>{x.tipo === "erro" ? `${x.prova} · ` : ""}{x.topico}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={{ color: cor, fontFamily: mono, fontSize: 11.5 }}>{selo} · {x.caixa}/5</Text>
        {onApagar && (
          <Pressable hitSlop={10} onPress={onApagar} accessibilityLabel="Apagar o cartão"><Trash size={15} color={c.faint} /></Pressable>
        )}
      </View>
    </View>
  );
}

/** Aba Revisão: caderno de erros, flashcards, sessão de revisão espaçada. */
export default function Revisao({ casca }: { casca: Casca }) {
  const painel = casca.p?.revisao;
  const itens = painel?.itens ?? [];
  const [sessao, setSessao] = useState<EstudosItemRevisao[] | null>(null);
  const [quantos, setQuantos] = useState(20);
  const [pedido, setPedido] = useState<EstudosFlashcards | null>(null);   // o retrato da geração à espera do Claude (tem o `quantos`)
  const [lista, setLista] = useState<"erros" | "cartoes" | null>(null);
  const inset = useSafeAreaInsets();
  const imersao = useRef(casca.setImersao);
  imersao.current = casca.setImersao;

  const ativos = itens.filter((x) => !x.dominada);
  const vencem = ativos.filter((x) => x.vence);
  const erros = itens.filter((x) => x.tipo === "erro");
  const cartoes = itens.filter((x) => x.tipo === "cartao");
  const dominados = itens.length - ativos.length;
  const gerando = casca.exec?.tipo === "flashcards" ? casca.exec : null;
  const aguardando = painel ? [...painel.geracoes].reverse().find((g) => g.status === "aguardando") : undefined;
  // a lista já abre no que tem coisa: um seletor em cima de um espaço vazio parecia quebrado
  const vista = lista ?? (erros.length || !cartoes.length ? "erros" : "cartoes");
  const daVista = vista === "erros" ? erros : cartoes;

  useEffect(() => { lerAjustes("estudos.cartoes", { quantos: 20 }).then((a) => setQuantos(a.quantos)); }, []);
  useEffect(() => { imersao.current(!!sessao); return () => imersao.current(false); }, [sessao]);
  // Pedido ao Claude (daqui ou do PC): o painel só diz que existe; o retrato traz quantos cartões foram pedidos.
  useEffect(() => {
    if (!aguardando) { setPedido(null); return; }
    api.get<EstudosFlashcards>(`/estudos/execucao/${aguardando.message_id}`).then(setPedido).catch(() => {});
  }, [aguardando?.message_id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const muda = (n: number) => { setQuantos(n); salvaAjustes("estudos.cartoes", { quantos: n }); };

  async function gerar() {
    if (gerando || aguardando) return;
    if (!casca.modelo) return toast("Escolha um modelo em Modelos (ou no chat) antes.");
    try {
      const id = await casca.garante();
      const u: EstudosFlashcards | null = await casca.segue(`/estudos/${id}/flashcards`, { quantos, ...casca.modelo });
      if (u?.aviso && u.status !== "pronto") casca.erro(u.aviso);
      else if (u?.status === "pronto") toast(`${plural(u.cartoes.length, "cartão novo", "cartões novos")}.`);
    } catch (e: any) { casca.erro(e.message); }
  }

  async function parar() {
    const id = gerando?.message_id ?? aguardando?.message_id;
    if (id == null) return;
    try { await api.post(`/estudos/execucao/${id}/cancelar`); } catch (e: any) { casca.erro(e.message); }
    casca.recarrega();
  }

  function apagar(x: EstudosItemRevisao & { tipo: "cartao" }) {
    pergunta("Apagar o cartão?", corta(semMarcas(x.frente), 120), [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Apagar", estilo: "perigo", acao: () => api.del(`/estudos/${casca.conv}/flashcards/${x.id}`).then(() => casca.recarrega()).catch((e) => casca.erro(e.message)) },
    ]);
  }

  /** O .csv para o Anki (frente, verso, tópico) pelo compartilhar do Android: a rota não devolve JSON. */
  async function exportar() {
    try {
      const r = await fetch(comToken(`${base()}/api/estudos/${casca.conv}/flashcards.csv`));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await compartilhaTexto("flashcards.csv", await r.text(), "text/csv");
    } catch (e: any) { casca.erro(e.message); }
  }

  function comecar(todos: boolean) {
    // vencidos primeiro (os de caixa mais baixa na frente); "mesmo assim" pega todos os não dominados
    setSessao((todos ? ativos : vencem).slice().sort((a, b) => a.caixa - b.caixa || a.proxima.localeCompare(b.proxima)));
  }

  if (sessao && casca.conv != null)
    return <Sessao casca={casca} conv={casca.conv} itens={sessao} onFim={() => { setSessao(null); casca.recarrega(); }} />;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: Math.max(inset.bottom, 14) }}>
      <View style={cartao()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View>
            <Text style={s.secao2}>PARA HOJE</Text>
            <Text style={{ color: vencem.length ? c.fg : c.muted, fontFamily: mono, fontSize: 36, fontWeight: "600", lineHeight: 42 }}>{vencem.length}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>
              <Text style={{ color: c.fg }}>{erros.length}</Text> {erros.length === 1 ? "questão" : "questões"} no caderno de erros{" · "}
              <Text style={{ color: c.fg }}>{cartoes.length}</Text> {cartoes.length === 1 ? "cartão" : "cartões"}
            </Text>
            <Text style={{ color: c.faint, fontSize: 12.5, lineHeight: 18 }}>
              {plural(dominados, "dominado", "dominados")} · revisão espaçada: errou, volta amanhã; acertou, espaça (1, 3, 7, 15, 30 dias)
            </Text>
          </View>
        </View>
        {vencem.length ? (
          <Botao primario altura={40} rotulo="Revisar agora" icone={<Refresh size={15} color={c.accentFg} />} onPress={() => comecar(false)} />
        ) : ativos.length ? (
          <>
            <Text style={{ color: c.faint, fontSize: 12.5, lineHeight: 18 }}>Nada vence hoje: dá para revisar tudo o que ainda não está dominado.</Text>
            <Botao altura={40} rotulo="Revisar mesmo assim" icone={<Refresh size={15} color={c.fg} />} onPress={() => comecar(true)} />
          </>
        ) : null}
      </View>

      {!itens.length && !gerando && !aguardando && (
        <View style={cartao()}>
          <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 21 }}>Aqui ficam o caderno de erros e os flashcards.</Text>
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>
            Toda questão que você erra numa prova (ou no treino) entra no caderno e volta para revisão nos dias certos.{" "}
            Os flashcards saem do resumo e dos seus erros, e vão para o Anki em .csv.
          </Text>
        </View>
      )}

      {!!aguardando && !gerando && (
        <View style={cartao()}>
          <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600" }}>Pedido enviado ao Claude</Text>
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>
            O Claude vai escrever {pedido?.quantos ?? "os"} flashcards do resumo e dos seus erros. No Claude Code conectado ao Forja, peça:{" "}
            <Text style={{ color: c.fg }}>“{PEDIDO_CLAUDE}”</Text>. A tela atualiza sozinha.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao flex altura={40} rotulo="Copiar o pedido" icone={<Copy size={14} color={c.fg} />}
                   onPress={() => Clipboard.setStringAsync(PEDIDO_CLAUDE).then(() => toast("Pedido copiado."))} />
            <Botao flex altura={40} rotulo="Cancelar pedido" icone={<X size={14} color={c.fg} />} onPress={parar} />
          </View>
        </View>
      )}

      <View style={cartao()}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600" }}>Flashcards</Text>
          <Text style={{ color: c.faint, fontSize: 12.5, lineHeight: 18 }}>Do resumo e dos erros, sem repetir os que você já tem.</Text>
        </View>
        {gerando ? <Progresso f={gerando} onParar={parar} /> : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Contador valor={quantos} min={4} max={60} passo={4} onMuda={muda} />
              <Text style={s.muted}>cartões</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Botao flex primario altura={40} rotulo="Gerar cartões" desabilitado={!!aguardando} onPress={gerar} />
              <Botao altura={40} rotulo="Anki (.csv)" icone={<Download size={15} color={c.fg} />} desabilitado={!cartoes.length} onPress={exportar} />
            </View>
          </>
        )}
      </View>

      {itens.length > 0 && (
        <>
          <Seletor cheio altura={34} valor={vista} onMuda={setLista}
                   opcoes={[{ id: "erros", rotulo: `Caderno de erros · ${erros.length}` }, { id: "cartoes", rotulo: `Cartões · ${cartoes.length}` }]} />
          <View style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
            {daVista.map((x, k) => (
              <Linha key={x.chave} x={x} primeira={k === 0} onApagar={x.tipo === "cartao" ? () => apagar(x) : undefined} />
            ))}
            {!daVista.length && <Text style={{ color: c.faint, fontSize: 13, padding: 12 }}>Nada aqui ainda.</Text>}
          </View>
        </>
      )}
    </ScrollView>
  );
}
