import { File } from "expo-file-system";
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StatusBar, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type WebView from "react-native-webview";
import { Text, TextInput } from "./Texto";
import { api, base, comToken } from "./api";
import { Download, Edit, ExternalLink, Folder, Play, Trash, X } from "./icones";
import { AcaoGrade, type Destino, salva } from "./Imagens";
import Mascara from "./Mascara";
import { c, mono, s } from "./tema";
import { Botao, BotaoIcone, Folha, Lista, toast } from "./ui";
import { VideoWeb } from "./Video";

// Vídeo pronto do Conteúdo no celular: assistir (com som), salvar (galeria, pasta, compartilhar) e pedir mudanças
// ao Claude como no PC — desenhar num quadro, marcar um trecho (aparece na barra de tempo) e um pedido geral.
// Mesma rota do PC: POST /conteudo/producao/<id>/revisar; o Claude faz a próxima versão e a atual fica.

export type ProducaoVideo = { id: number; titulo: string; entregue: string; formato?: "vertical" | "horizontal"; versao?: number };
type Pedido =
  | { tipo: "quadro"; tempo: number; comentario: string; imagem: string; previa: string }
  | { tipo: "trecho"; inicio: number; fim: number; comentario: string };

const relogio = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0").replace(".", ",")}`;
// O quadro na tela, do próprio <video> do WebView (mesma origem: o canvas não fica "sujo"), em JPEG para a prévia.
const CAPTURA = `(function(){var v=document.getElementById("v");v.pause();var k=document.createElement("canvas");` +
  `k.width=v.videoWidth;k.height=v.videoHeight;k.getContext("2d").drawImage(v,0,0);` +
  `window.ReactNativeWebView.postMessage(JSON.stringify({quadro:k.toDataURL("image/jpeg",0.92),w:v.videoWidth,h:v.videoHeight,t:v.currentTime}))})();true;`;

export default function ConteudoVideo({ p, onFecha, onEnviado }: { p: ProducaoVideo | null; onFecha: () => void; onEnviado: () => void }) {
  if (!p) return null;
  return <Player key={p.id} p={p} onFecha={onFecha} onEnviado={onEnviado} />;
}

function Player({ p, onFecha, onEnviado }: { p: ProducaoVideo; onFecha: () => void; onEnviado: () => void }) {
  const inset = useSafeAreaInsets();
  const { height: alt } = useWindowDimensions();
  const web = useRef<WebView>(null);
  const [tempo, setTempo] = useState({ t: 0, d: 0 });
  const [larg, setLarg] = useState(0);
  const [salvar, setSalvar] = useState(false);
  const [editando, setEditando] = useState(false);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [trecho, setTrecho] = useState<{ inicio: number | null; fim: number | null; comentario: string }>({ inicio: null, fim: null, comentario: "" });
  const [geral, setGeral] = useState("");
  const [quadro, setQuadro] = useState<{ uri: string; w: number; h: number; t: number } | null>(null);
  const [desenho, setDesenho] = useState<{ uri: string; t: number } | null>(null);   // anotado, esperando o comentário
  const [comentQuadro, setComentQuadro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const src = comToken(`${base()}/api/conteudo/video/${p.id}`);
  const proxima = (p.versao ?? 1) + 1;

  async function paraDestino(d: Destino) {
    setSalvar(false);
    try { const aviso = await salva([p.entregue || `forja-${p.id}.mp4`], d, "video/mp4", () => src); if (aviso) toast(aviso); }
    catch (e: any) { if (!/cancel/i.test(String(e?.message))) toast(e.message); }
  }
  const ir = (x: number) => { if (tempo.d && larg) web.current?.injectJavaScript(`v.currentTime=${(x / larg) * tempo.d};true;`); };
  const marcar = (ponta: "inicio" | "fim") => setTrecho((x) => ({ ...x, [ponta]: tempo.t }));
  const trechoPronto = trecho.inicio !== null && trecho.fim !== null && !!trecho.comentario.trim();
  const faixas = [
    ...pedidos.flatMap((x) => (x.tipo === "trecho" ? [{ a: x.inicio, b: x.fim, atual: false }] : [])),
    ...(trecho.inicio !== null || trecho.fim !== null
      ? [{ a: (trecho.inicio ?? trecho.fim)!, b: trecho.inicio !== null && trecho.fim !== null ? trecho.fim : null, atual: true }] : []),
  ];

  async function enviar() {
    setEnviando(true);
    try {
      await api.post(`/conteudo/producao/${p.id}/revisar`, {
        pedidos: pedidos.map((x) => (x.tipo === "quadro" ? { tipo: x.tipo, tempo: x.tempo, comentario: x.comentario, imagem: x.imagem } : x)),
        geral,
      });
      toast(`O Claude começou a versão ${proxima}`);
      onEnviado();
    } catch (e: any) {
      toast(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onFecha} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: inset.top }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          <BotaoIcone lado={44} fundo="transparent" onPress={onFecha}><X size={22} color={c.fg} /></BotaoIcone>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 14 }} numberOfLines={1}>{(p.versao ?? 1) > 1 ? `v${p.versao} · ` : ""}{p.titulo}</Text>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>{p.entregue.split(/[\\/]/).pop()}</Text>
          </View>
        </View>

        <View style={{ height: editando ? alt * 0.42 : undefined, flex: editando ? undefined : 1, minHeight: 0 }}>
          <VideoWeb path="" src={src} web={web} onTempo={(t, d) => setTempo({ t, d })}
                    onMensagem={(m) => setQuadro({ uri: m.quadro, w: m.w, h: m.h, t: m.t })} />
        </View>

        {/* barra de tempo: tocar pula; os trechos marcados aparecem por cima (o atual em âmbar) */}
        <View style={{ paddingHorizontal: 14, paddingTop: 10, gap: 6 }}>
          <Pressable onLayout={(e) => setLarg(e.nativeEvent.layout.width)} hitSlop={12} onPress={(e) => ir(e.nativeEvent.locationX)}
                     style={{ height: 6, borderRadius: 3, backgroundColor: c.line, justifyContent: "center" }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: c.accent, width: `${tempo.d ? Math.min(100, (tempo.t / tempo.d) * 100) : 0}%` }} />
            {tempo.d > 0 && faixas.map((f, i) => {
              const a = Math.min(f.a, f.b ?? f.a) / tempo.d, b = Math.max(f.a, f.b ?? f.a) / tempo.d;
              const cor = f.atual ? "#fcd34d" : "#7dd3fc";
              return f.b === null ? (
                <View key={i} pointerEvents="none" style={{ position: "absolute", left: `${a * 100}%`, top: -6, width: 3, height: 18, marginLeft: -1.5, borderRadius: 2, backgroundColor: cor }} />
              ) : (
                <View key={i} pointerEvents="none" style={{ position: "absolute", left: `${a * 100}%`, width: `${Math.max(1, (b - a) * 100)}%`, top: -4, height: 14,
                                                             borderRadius: 3, borderLeftWidth: 2, borderRightWidth: 2, borderColor: cor, backgroundColor: f.atual ? "#fcd34d55" : "#7dd3fc33" }} />
              );
            })}
          </Pressable>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{relogio(tempo.t)}</Text>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{relogio(tempo.d)}</Text>
          </View>
        </View>

        {!editando ? (
          <View style={{ flexDirection: "row", gap: 6, padding: 12, paddingBottom: inset.bottom + 12 }}>
            <AcaoGrade altura={60} rotulo="Salvar" icone={<Download size={18} color={c.fg} />} onPress={() => setSalvar(true)} />
            <AcaoGrade altura={60} rotulo="Pedir mudanças" icone={<Edit size={18} color={c.fg} />}
                       onPress={() => { web.current?.injectJavaScript("v.pause();true;"); setEditando(true); }} />
          </View>
        ) : (
          <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: inset.bottom + 16 }}
                      keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={[s.secao, { flex: 1 }]}>PEDIR MUDANÇAS</Text>
              <Pressable hitSlop={8} onPress={() => setEditando(false)}><Text style={s.faint}>fechar</Text></Pressable>
            </View>

            <Botao rotulo="Desenhar neste quadro" icone={<Edit size={16} color={c.fg} />} onPress={() => web.current?.injectJavaScript(CAPTURA)} />

            <Text style={s.faint}>Num trecho: toque em Início e Fim com o vídeo no ponto certo.</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Botao flex rotulo={trecho.inicio !== null ? `Início ${relogio(trecho.inicio)}` : "Início"} onPress={() => marcar("inicio")} />
              <Botao flex rotulo={trecho.fim !== null ? `Fim ${relogio(trecho.fim)}` : "Fim"} onPress={() => marcar("fim")} />
            </View>
            {(trecho.inicio !== null || trecho.fim !== null) && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: "#fcd34d" }} />
                <Text style={[s.muted, { flex: 1, fontSize: 12.5 }]}>
                  {trecho.inicio !== null && trecho.fim !== null
                    ? `${relogio(Math.min(trecho.inicio, trecho.fim))} até ${relogio(Math.max(trecho.inicio, trecho.fim))} · ${Math.abs(trecho.fim - trecho.inicio).toFixed(1).replace(".", ",")} s`
                    : `Agora marque o ${trecho.inicio === null ? "início" : "fim"}`}
                </Text>
                <Pressable hitSlop={8} onPress={() => setTrecho((x) => ({ ...x, inicio: null, fim: null }))}><Text style={s.faint}>limpar</Text></Pressable>
              </View>
            )}
            <TextInput value={trecho.comentario} onChangeText={(t) => setTrecho((x) => ({ ...x, comentario: t }))} multiline
                       placeholder="Ex.: troque por um trecho real do trailer (cole o link, se tiver)" placeholderTextColor={c.faint} style={campo} />
            <Botao rotulo="Adicionar trecho" desabilitado={!trechoPronto} onPress={() => {
              setPedidos((ps) => [...ps, { tipo: "trecho", inicio: Math.min(trecho.inicio!, trecho.fim!), fim: Math.max(trecho.inicio!, trecho.fim!),
                                           comentario: trecho.comentario.trim() }]);
              setTrecho({ inicio: null, fim: null, comentario: "" });
            }} />

            {pedidos.length > 0 && <Text style={s.secao}>PEDIDOS · {pedidos.length}</Text>}
            {pedidos.map((x, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 10 }}>
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5, width: 74 }}>
                  {x.tipo === "quadro" ? `quadro\n${relogio(x.tempo)}` : `${relogio(x.inicio)}\naté ${relogio(x.fim)}`}
                </Text>
                <Text style={[s.txt, { flex: 1, fontSize: 13.5 }]}>{x.comentario}</Text>
                <Pressable hitSlop={8} onPress={() => setPedidos((ps) => ps.filter((_, j) => j !== i))} accessibilityLabel="Tirar pedido">
                  <Trash size={16} color={c.muted} />
                </Pressable>
              </View>
            ))}

            <Text style={s.faint}>No vídeo todo</Text>
            <TextInput value={geral} onChangeText={setGeral} multiline placeholder="Ex.: música mais baixa; mostre 5 s do trailer oficial"
                       placeholderTextColor={c.faint} style={campo} />
            <Botao primario altura={46} rotulo={enviando ? "Enviando…" : `Fazer a versão ${proxima}`} icone={<Play size={16} color={c.accentFg} />}
                   desabilitado={enviando || (!pedidos.length && !geral.trim())} onPress={enviar} />
            <Text style={[s.faint, { fontSize: 12 }]}>O Claude retoma a sessão que fez o vídeo, muda só o que foi pedido e entrega a versão {proxima}; a atual continua guardada.</Text>
          </ScrollView>
        )}

        <Folha aberta={salvar} titulo="Salvar vídeo" onFecha={() => setSalvar(false)}>
          <Lista<Destino> valor={"" as Destino} onEscolhe={paraDestino} opcoes={[
            { id: "galeria", rotulo: "Galeria", dica: "Junto dos vídeos da câmera (DCIM)", icone: <Download size={17} color={c.muted} /> },
            { id: "pasta", rotulo: "Escolher pasta…", dica: "Qualquer pasta do celular ou do cartão", icone: <Folder size={17} color={c.muted} /> },
            { id: "compartilhar", rotulo: "Compartilhar…", dica: "YouTube, WhatsApp, Drive ou outro app", icone: <ExternalLink size={17} color={c.muted} /> },
          ]} />
        </Folha>

        <Mascara soAnotacao alvo={quadro ? { path: `quadro-${p.id}`, w: quadro.w, h: quadro.h, uri: quadro.uri } : null}
                 onFecha={() => setQuadro(null)}
                 onPronta={(uri) => { const t = quadro!.t; setQuadro(null); setComentQuadro(""); setDesenho({ uri, t }); }} />
        <Folha aberta={!!desenho} titulo="O que mudar no que você marcou?" onFecha={() => setDesenho(null)}>
          <TextInput value={comentQuadro} onChangeText={setComentQuadro} multiline autoFocus placeholder="Ex.: deixe esse número maior e com brilho"
                     placeholderTextColor={c.faint} style={campo} />
          <Botao primario rotulo="Adicionar" desabilitado={!comentQuadro.trim()} onPress={async () => {
            const d = desenho!;
            try {
              const b64 = await new File(d.uri).base64();
              setPedidos((ps) => [...ps, { tipo: "quadro", tempo: d.t, comentario: comentQuadro.trim(), imagem: `data:image/png;base64,${b64}`, previa: d.uri }]);
              setDesenho(null);
            } catch (e: any) { toast(e.message); }
          }} />
        </Folha>
      </View>
    </Modal>
  );
}

const campo = { minHeight: 64, color: c.fg, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.line,
                paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlignVertical: "top" as const };
