import { useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useGestos } from "./gestos";
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
  const { width, height: altura } = useWindowDimensions();
  const [modo, setModo] = useState<Modo>("mascara");
  const [cor, setCor] = useState(CORES[0]);
  const [pincel, setPincel] = useState(48);
  const [borracha, setBorracha] = useState(false);
  const [tracos, setTracos] = useState<Traco[]>([]);
  const [pilha, setPilha] = useState<Traco[][]>([]); // desfazer: até 20 estados
  const [atual, setAtual] = useState<Traco | null>(null);
  const [gerando, setGerando] = useState(false);
  const exporta = useRef<View>(null);

  // A imagem ocupa o máximo da área entre o topo e a barra de ferramentas, contida nos dois eixos (sem zoom ao abrir).
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const r = alvo.w / alvo.h;
  const cabeW = (area?.w ?? width) - 24, cabeH = (area?.h ?? width) - 36;
  const dw = Math.max(1, Math.min(cabeW, cabeH * r)), dh = dw / r;
  const escala = alvo.w / dw; // px da original por ponto da tela, com zoom 1

  const salvaEstado = (t: Traco[]) => setPilha((p) => [...p.slice(-19), t]);
  // Um dedo desenha (ponto já na camada sem zoom → px da original); pinça e dois dedos ficam com o useGestos.
  const traco = useRef<{ t: Traco | null; pts: string[] }>({ t: null, pts: [] });
  const px = (v: number) => Math.round(v * escala);
  const { vista, zoom: mudaZoom, caixa, mede, handlers } = useGestos({ w: dw, h: dh }, {
    inicio: (x, y) => {
      traco.current.pts = [`M${px(x)} ${px(y)}`, `L${px(x) + 0.1} ${px(y)}`];
      traco.current.t = { d: traco.current.pts.join(""), largura: pincel, cor: modo === "mascara" ? "#fff" : cor, borracha };
      setAtual(traco.current.t);
    },
    move: (x, y) => {
      if (!traco.current.t) return;
      traco.current.pts.push(`L${px(x)} ${px(y)}`);
      traco.current.t = { ...traco.current.t, d: traco.current.pts.join("") };
      setAtual(traco.current.t);
    },
    fim: () => {
      const t = traco.current.t;
      traco.current.t = null;
      setAtual(null);
      if (t) setTracos((ts) => { salvaEstado(ts); return [...ts, t]; });
    },
    cancela: () => { traco.current.t = null; setAtual(null); },
  });

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
  const zoom = mudaZoom;

  // Celular girado: a imagem fica à esquerda e todos os controles numa coluna à direita, para desenhar deitado.
  const deitado = width > altura;
  const topo = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: deitado ? 4 : 8, paddingVertical: 6 }}>
      <BotaoIcone lado={44} fundo="transparent" onPress={onFecha}><X size={22} color={c.fg} /></BotaoIcone>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>Marcar onde editar</Text>
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>
          {alvo.w}×{alvo.h} · {modo === "mascara" ? "máscara" : "anotação"}{modelo ? ` · ${modelo}` : ""}
        </Text>
      </View>
      <Botao primario rotulo={gerando ? "Gerando…" : "Usar"} desabilitado={!pintados || gerando} onPress={usar} />
    </View>
  );
  const modos = (
    <View style={{ paddingHorizontal: deitado ? 12 : 16, gap: 6 }}>
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
  );
  const areaDesenho = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
          onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View ref={caixa} collapsable={false} onLayout={mede} style={{ width: dw, height: dh }} {...handlers}>
        <View pointerEvents="none" style={{ width: dw, height: dh, transform: [{ translateX: vista.x }, { translateY: vista.y }, { scale: vista.z }] }}>
          <Image source={{ uri: urlImagem(alvo.path) }} style={{ width: dw, height: dh }} resizeMode="contain" />
          <View style={{ position: "absolute", left: 0, top: 0, width: dw, height: dh, opacity: modo === "mascara" ? 0.55 : 1 }}>
            {camada(false, "tela")}
          </View>
        </View>
      </View>
      <View style={{ position: "absolute", right: 12, top: 8, gap: 6 }}>
        <BotaoIcone lado={38} fundo="#0009" onPress={() => zoom(vista.z + 0.5)}><Text style={{ color: "#fff", fontSize: 18 }}>+</Text></BotaoIcone>
        <BotaoIcone lado={38} fundo="#0009" onPress={() => zoom(vista.z - 0.5)}><Text style={{ color: "#fff", fontSize: 18 }}>−</Text></BotaoIcone>
        <BotaoIcone lado={38} fundo="#0009" onPress={() => zoom(1)}>
          <Text style={{ color: "#fff", fontFamily: mono, fontSize: 11 }}>{vista.z === 1 ? "1×" : `${String(Math.round(vista.z * 10) / 10).replace(".", ",")}×`}</Text>
        </BotaoIcone>
      </View>
      <Text style={{ position: "absolute", bottom: 6, color: c.faint, fontSize: 11.5 }}>Pinça: zoom · dois dedos: mover</Text>
    </View>
  );
  const ferramentas = [
    ferramenta("Pincel", <Edit size={18} color={!borracha ? c.accentText : c.fg} />, !borracha, () => setBorracha(false)),
    ferramenta("Borracha", <Square size={16} color={borracha ? c.accentText : c.fg} />, borracha, () => setBorracha(true)),
    ferramenta("Desfazer", <Undo size={18} color={c.fg} />, false, () => { setTracos(pilha[pilha.length - 1] ?? []); setPilha((p) => p.slice(0, -1)); }, !pilha.length),
    ferramenta("Limpar", <Trash size={18} color={c.fg} />, false, () => { salvaEstado(tracos); setTracos([]); }, !tracos.length),
  ];
  const barra = (
    <View style={{ gap: 12 }}>
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
      {deitado ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>{ferramentas.slice(0, 2)}</View>
          <View style={{ flexDirection: "row", gap: 6 }}>{ferramentas.slice(2)}</View>
        </View>
      ) : <View style={{ flexDirection: "row", gap: 6 }}>{ferramentas}</View>}
    </View>
  );

  return (
    <Modal visible animationType="fade" onRequestClose={onFecha} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      {deitado ? (
        <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg, paddingLeft: inset.left }}>
          {areaDesenho}
          <View style={{ width: Math.min(340, width * 0.42), backgroundColor: c.side, borderLeftWidth: 1, borderLeftColor: c.line, paddingTop: inset.top,
                         paddingRight: inset.right }}>
            <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: inset.bottom + 12 }}>
              {topo}
              {modos}
              <View style={{ paddingHorizontal: 12 }}>{barra}</View>
            </ScrollView>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: inset.top }}>
          {topo}
          {modos}
          {areaDesenho}
          <View style={{ backgroundColor: c.side, borderTopWidth: 1, borderTopColor: c.line, padding: 14, paddingBottom: inset.bottom + 14 }}>{barra}</View>
        </View>
      )}
      {/* Camada de exportação fora da tela: o captureRef a redimensiona para o tamanho da original. */}
      <View ref={exporta} collapsable={false} style={{ position: "absolute", left: -10000, top: 0, width: dw, height: dh, backgroundColor: "#000" }}>
        {modo === "anotacao" && <Image source={{ uri: urlImagem(alvo.path) }} style={{ width: dw, height: dh }} resizeMode="stretch" />}
        {camada(modo === "mascara", "exporta")}
      </View>
    </Modal>
  );
}
