import { useRef, useState } from "react";
import { Image, Modal, PanResponder, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, G, Mask, Path, Rect } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { urlImagem } from "./api";
import { Edit, Square, Trash, Undo, X } from "./icones";
import { Text } from "./Texto";
import { c, mono } from "./tema";
import { Botao, BotaoIcone, Deslizador } from "./ui";

// Editor de máscara (MascaraEditor.tsx do desktop). Traços em px da imagem original (o viewBox do SVG é o
// tamanho dela), pinça para zoom de 1 a 4× e dois dedos para mover. "Usar" gera o PNG no tamanho da original:
// máscara = branco onde pintou, preto no resto; anotação = a imagem com as marcas.
type Modo = "mascara" | "anotacao";
type Traco = { d: string; largura: number; cor: string; borracha: boolean };
const CORES = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#ffffff"];
const DICA: Record<Modo, string> = {
  mascara: "Pinte onde muda. A original vai inteira e só a área branca é refeita.",
  anotacao: "Circule com cores e cite no prompt (\"remove the watch in the blue circle\"). A marca cobre parte da imagem.",
};

export default function Mascara({ alvo, modelo, onFecha, onPronta }: {
  alvo: { path: string; w: number; h: number } | null; modelo?: string; onFecha: () => void;
  onPronta: (uri: string, modo: Modo, tracos: number) => void;
}) {
  if (!alvo) return null;
  return <Editor key={alvo.path} alvo={alvo} modelo={modelo} onFecha={onFecha} onPronta={onPronta} />;
}

function Editor({ alvo, modelo, onFecha, onPronta }: {
  alvo: { path: string; w: number; h: number }; modelo?: string; onFecha: () => void; onPronta: (uri: string, modo: Modo, tracos: number) => void;
}) {
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [modo, setModo] = useState<Modo>("mascara");
  const [cor, setCor] = useState(CORES[0]);
  const [pincel, setPincel] = useState(48);
  const [borracha, setBorracha] = useState(false);
  const [tracos, setTracos] = useState<Traco[]>([]);
  const [pilha, setPilha] = useState<Traco[][]>([]); // desfazer: até 20 estados
  const [atual, setAtual] = useState<Traco | null>(null);
  const [vista, setVista] = useState({ z: 1, x: 0, y: 0 });
  const [gerando, setGerando] = useState(false);
  const exporta = useRef<View>(null);

  // A imagem ocupa o máximo da área entre o topo e a barra de ferramentas, contida nos dois eixos (sem zoom ao abrir).
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const r = alvo.w / alvo.h;
  const cabeW = (area?.w ?? width) - 24, cabeH = (area?.h ?? width) - 36;
  const dw = Math.max(1, Math.min(cabeW, cabeH * r)), dh = dw / r;
  const escala = alvo.w / dw; // px da original por ponto da tela, com zoom 1

  // Os refs guardam o que o PanResponder (criado uma vez) precisa ler atualizado.
  const st = useRef({ vista, pincel, borracha, cor, modo, atual: null as Traco | null, pts: [] as string[], gesto: null as null | { d: number; mx: number; my: number; v: typeof vista } });
  st.current = { ...st.current, vista, pincel, borracha, cor, modo };
  // locationX/Y já vêm no espaço da camada (antes do zoom e do arrasto): basta passar para px da original
  const paraImagem = (x: number, y: number) => [Math.round(x * escala), Math.round(y * escala)];
  const salvaEstado = (t: Traco[]) => setPilha((p) => [...p.slice(-19), t]);
  const resp = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const [x, y] = paraImagem(locationX, locationY);
      st.current.pts = [`M${x} ${y}`, `L${x + 0.1} ${y}`];
      const t = { d: st.current.pts.join(""), largura: st.current.pincel,
                  cor: st.current.modo === "mascara" ? "#fff" : st.current.cor, borracha: st.current.borracha };
      st.current.atual = t;
      setAtual(t);
    },
    onPanResponderMove: (e) => {
      const toques = e.nativeEvent.touches;
      if (toques.length >= 2) {
        // pinça + dois dedos: cancela o traço e mexe no zoom e na posição
        st.current.atual = null;
        setAtual(null);
        const [a, b] = toques;
        const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), mx = (a.pageX + b.pageX) / 2, my = (a.pageY + b.pageY) / 2;
        const g = st.current.gesto ?? (st.current.gesto = { d, mx, my, v: st.current.vista });
        const z = Math.min(4, Math.max(1, g.v.z * (d / g.d)));
        setVista({ z, x: g.v.x + (mx - g.mx), y: g.v.y + (my - g.my) });
        return;
      }
      if (!st.current.atual) return;
      const [x, y] = paraImagem(e.nativeEvent.locationX, e.nativeEvent.locationY);
      st.current.pts.push(`L${x} ${y}`);
      const t = { ...st.current.atual, d: st.current.pts.join("") };
      st.current.atual = t;
      setAtual(t);
    },
    onPanResponderRelease: () => {
      st.current.gesto = null;
      const t = st.current.atual;
      st.current.atual = null;
      setAtual(null);
      if (t) setTracos((ts) => { salvaEstado(ts); return [...ts, t]; });
    },
    onPanResponderTerminate: () => { st.current.gesto = null; st.current.atual = null; setAtual(null); },
  })).current;

  const pintados = tracos.filter((t) => !t.borracha).length;
  const todos = atual ? [...tracos, atual] : tracos;
  const camada = (fundoPreto: boolean, id: string) => (
    <Svg width="100%" height="100%" viewBox={`0 0 ${alvo.w} ${alvo.h}`} style={{ position: "absolute" }}>
      <Defs>
        {/* borracha = preto na máscara da camada: apaga o que estiver por baixo, de qualquer cor */}
        <Mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={alvo.w} height={alvo.h}>
          <Rect x={0} y={0} width={alvo.w} height={alvo.h} fill="#fff" />
          {todos.map((t, i) => t.borracha &&
            <Path key={i} d={t.d} stroke="#000" strokeWidth={t.largura} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        </Mask>
      </Defs>
      {fundoPreto && <Rect x={0} y={0} width={alvo.w} height={alvo.h} fill="#000" />}
      <G mask={`url(#${id})`}>
        {todos.map((t, i) => !t.borracha &&
          <Path key={i} d={t.d} stroke={modo === "mascara" || fundoPreto ? "#fff" : t.cor} strokeWidth={t.largura} strokeLinecap="round"
                strokeLinejoin="round" fill="none" />)}
      </G>
    </Svg>
  );

  async function usar() {
    setGerando(true);
    try {
      const uri = await captureRef(exporta, { format: "png", result: "tmpfile", width: alvo.w, height: alvo.h });
      onPronta(uri, modo, pintados);
    } catch { setGerando(false); }
  }

  const ferramenta = (rotulo: string, icone: React.ReactNode, on: boolean, onPress: () => void, desabilitado?: boolean) => (
    <Pressable onPress={onPress} disabled={desabilitado}
               style={{ flex: 1, height: 56, borderRadius: 12, borderWidth: 1, gap: 4, alignItems: "center", justifyContent: "center",
                        borderColor: on ? c.accentLine : c.line, backgroundColor: on ? c.accentSoft : "transparent", opacity: desabilitado ? 0.4 : 1 }}>
      {icone}
      <Text style={{ color: on ? c.accentText : c.fg, fontSize: 12.5 }} numberOfLines={1}>{rotulo}</Text>
    </Pressable>
  );
  const zoom = (z: number) => setVista((v) => (z <= 1 ? { z: 1, x: 0, y: 0 } : { ...v, z: Math.min(4, z) }));

  return (
    <Modal visible animationType="fade" onRequestClose={onFecha} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: inset.top }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          <BotaoIcone lado={44} fundo="transparent" onPress={onFecha}><X size={22} color={c.fg} /></BotaoIcone>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>Marcar onde editar</Text>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>
              {alvo.w}×{alvo.h} · {modo === "mascara" ? "máscara" : "anotação"}{modelo ? ` · ${modelo}` : ""}
            </Text>
          </View>
          <Botao primario rotulo={gerando ? "Gerando…" : "Usar"} desabilitado={!pintados || gerando} onPress={usar} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["mascara", "anotacao"] as const).map((m) => (
              <Pressable key={m} onPress={() => setModo(m)}
                         style={{ flex: 1, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center",
                                  borderColor: modo === m ? c.accentLine : c.line, backgroundColor: modo === m ? c.accentSoft : "transparent" }}>
                <Text style={{ color: modo === m ? c.accentText : c.muted, fontSize: 13.5, fontWeight: modo === m ? "600" : "400" }}>
                  {m === "mascara" ? "Máscara" : "Anotação"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: c.faint, fontSize: 12, minHeight: 34, lineHeight: 17 }}>{DICA[modo]}</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
              onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <View style={{ width: dw, height: dh, transform: [{ translateX: vista.x }, { translateY: vista.y }, { scale: vista.z }] }} {...resp.panHandlers}>
            <Image source={{ uri: urlImagem(alvo.path) }} style={{ width: dw, height: dh }} resizeMode="contain" />
            <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: dw, height: dh, opacity: modo === "mascara" ? 0.55 : 1 }}>
              {camada(false, "tela")}
            </View>
          </View>
          <View style={{ position: "absolute", right: 12, top: 8, gap: 6 }}>
            <BotaoIcone lado={38} fundo="#0009" onPress={() => zoom(vista.z + 0.5)}><Text style={{ color: "#fff", fontSize: 18 }}>+</Text></BotaoIcone>
            <BotaoIcone lado={38} fundo="#0009" onPress={() => zoom(vista.z - 0.5)}><Text style={{ color: "#fff", fontSize: 18 }}>−</Text></BotaoIcone>
            <BotaoIcone lado={38} fundo="#0009" onPress={() => zoom(1)}><Text style={{ color: "#fff", fontFamily: mono, fontSize: 12 }}>1×</Text></BotaoIcone>
          </View>
          <Text style={{ position: "absolute", bottom: 6, color: c.faint, fontSize: 11.5 }}>Pinça: zoom · dois dedos: mover</Text>
        </View>
        <View style={{ backgroundColor: c.side, borderTopWidth: 1, borderTopColor: c.line, padding: 14, paddingBottom: inset.bottom + 14, gap: 12 }}>
          {modo === "anotacao" && (
            <View style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}>
              {CORES.map((k) => (
                <Pressable key={k} onPress={() => { setCor(k); setBorracha(false); }}
                           style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: k, borderWidth: 2, borderColor: cor === k ? c.accent : "transparent" }} />
              ))}
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: Math.min(44, (pincel / escala) * vista.z), height: Math.min(44, (pincel / escala) * vista.z),
                             borderRadius: 22, backgroundColor: modo === "mascara" ? "#fff" : cor, opacity: 0.8 }} />
            </View>
            <View style={{ flex: 1 }}>
              <Deslizador rotulo="Pincel" valor={pincel} min={8} max={160} passo={4} onMuda={setPincel} fmt={(n) => `${n} px`} />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {ferramenta("Pincel", <Edit size={18} color={!borracha ? c.accentText : c.fg} />, !borracha, () => setBorracha(false))}
            {ferramenta("Borracha", <Square size={16} color={borracha ? c.accentText : c.fg} />, borracha, () => setBorracha(true))}
            {ferramenta("Desfazer", <Undo size={18} color={c.fg} />, false, () => { setTracos(pilha[pilha.length - 1] ?? []); setPilha((p) => p.slice(0, -1)); }, !pilha.length)}
            {ferramenta("Limpar", <Trash size={18} color={c.fg} />, false, () => { salvaEstado(tracos); setTracos([]); }, !tracos.length)}
          </View>
        </View>
        {/* Camada de exportação fora da tela: o captureRef a redimensiona para o tamanho da original. */}
        <View ref={exporta} collapsable={false} style={{ position: "absolute", left: -10000, top: 0, width: dw, height: dh, backgroundColor: "#000" }}>
          {modo === "anotacao" && <Image source={{ uri: urlImagem(alvo.path) }} style={{ width: dw, height: dh }} resizeMode="stretch" />}
          {camada(modo === "mascara", "exporta")}
        </View>
      </View>
    </Modal>
  );
}
