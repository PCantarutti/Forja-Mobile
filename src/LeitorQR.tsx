import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { c, s } from "./tema";

type P = { x: number; y: number };

const BRACO = 28; // lado do "L" de cada canto, em dp
const BASE = [0, 90, 180, 270]; // o mesmo L girado vira TL, TR, BR, BL

/** 4 pontos do evento: cornerPoints se vierem completos, senão o retângulo de bounds. */
export function pontos({ cornerPoints: cp, bounds: b }: Pick<BarcodeScanningResult, "cornerPoints" | "bounds">): P[] | null {
  if (cp?.length === 4 && cp.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return cp.map(({ x, y }) => ({ x, y }));
  if (!b?.size?.width || !b.size.height) return null;
  const { x, y } = b.origin, { width: w, height: h } = b.size;
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

const centro = (p: P[]): P => ({ x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length });

/** Descarta leitura degenerada (área < 400 dp², shoelace) ou com centro fora da view. */
export function valido(p: P[], w: number, h: number) {
  const area = Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y; }, 0)) / 2;
  const m = centro(p), mg = 20;
  return area >= 400 && m.x > -mg && m.y > -mg && m.x < w + mg && m.y < h + mg;
}

/** Ordena TL,TR,BR,BL em qualquer plataforma: ângulo em volta do centro, começando pelo menor x+y. */
export function ordena(p: P[]): P[] {
  const m = centro(p);
  const o = [...p].sort((a, b) => Math.atan2(a.y - m.y, a.x - m.x) - Math.atan2(b.y - m.y, b.x - m.x));
  const i = o.reduce((k, q, j) => (q.x + q.y < o[k].x + o[k].y ? j : k), 0);
  return [...o.slice(i), ...o.slice(0, i)];
}

/** Afasta cada ponto `d` dp do centro, para os cantos abraçarem o QR em vez de cobri-lo. */
export function expande(p: P[], d: number): P[] {
  const m = centro(p);
  return p.map((q) => { const dx = q.x - m.x, dy = q.y - m.y, n = Math.hypot(dx, dy) || 1; return { x: q.x + (dx / n) * d, y: q.y + (dy / n) * d }; });
}

/** Ângulo da aresta TL→TR em graus, em (-45, 45], e escala do braço pelo lado médio. */
export function pose(p: P[]) {
  let a = (Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) * 180) / Math.PI;
  while (a > 45) a -= 90;
  while (a <= -45) a += 90;
  const lado = p.reduce((t, q, i) => t + Math.hypot(p[(i + 1) % 4].x - q.x, p[(i + 1) % 4].y - q.y), 0) / 4;
  return { rot: a, esc: Math.min(1, Math.max(0.6, lado / 80)) };
}

/** Quadrado ocioso centralizado, lado 0.62·min(w,h). */
const ocioso = (w: number, h: number): P[] => {
  const l = 0.62 * Math.min(w, h), x = (w - l) / 2, y = (h - l) / 2;
  return [{ x, y }, { x: x + l, y }, { x: x + l, y: y + l }, { x, y: y + l }];
};

/**
 * Câmera com 4 cantos que respiram no centro e, ao ver um QR, encaixam em volta dele com mola.
 * Não passar `ratio`/`pictureSize` ao CameraView: o preview mudaria de campo de visão e a análise não,
 * desalinhando os cantos. Tudo por frame vive em refs + Animated (native driver), sem setState.
 */
export default function LeitorQR({ onLido, dica, erro }: { onLido: (data: string) => Promise<void>; dica: string; erro?: string }) {
  const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
  const [lido, setLido] = useState(false);
  const pos = useRef(BASE.map(() => new Animated.ValueXY())).current;
  const rot = useRef(new Animated.Value(0)).current;
  const esc = useRef(new Animated.Value(1)).current;
  const pulso = useRef(new Animated.Value(1)).current; // respiração e "pop" da confirmação
  const r = useRef({
    estado: "procurando" as "procurando" | "travando" | "lido",
    alvo: [] as P[], mov: 0, data: "", desde: 0, reduz: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    respira: null as Animated.CompositeAnimation | null,
  }).current;

  const mola = (v: Animated.Value | Animated.ValueXY, to: number | P) =>
    r.reduz ? Animated.timing(v, { toValue: to, duration: 0, useNativeDriver: true })
            : Animated.spring(v, { toValue: to, damping: 16, stiffness: 200, mass: 0.8, useNativeDriver: true });

  const vai = (p: P[], a: number, e: number) => {
    r.alvo = p; r.mov = Date.now();
    Animated.parallel([...pos.map((v, i) => mola(v, p[i])), mola(rot, a), mola(esc, e)]).start();
  };

  const respira = () => {
    r.respira?.stop();
    pulso.setValue(1);
    if (r.reduz) return;
    r.respira = Animated.loop(Animated.sequence([
      Animated.timing(pulso, { toValue: 1.06, duration: 900, useNativeDriver: true }),
      Animated.timing(pulso, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    r.respira.start();
  };

  const volta = () => {
    clearTimeout(r.timer);
    r.estado = "procurando";
    if (tam) vai(ocioso(tam.w, tam.h), 0, 1);
    respira();
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { r.reduz = v; if (v) respira(); }).catch(() => {});
    respira();
    return () => { clearTimeout(r.timer); r.respira?.stop(); };
  }, []);

  // Layout novo (inclusive giro de tela): refaz o quadrado ocioso na hora.
  useEffect(() => {
    if (!tam || r.estado !== "procurando") return;
    ocioso(tam.w, tam.h).forEach((p, i) => pos[i].setValue(p));
  }, [tam]);

  const confirma = async (data: string) => {
    r.estado = "lido";
    clearTimeout(r.timer);
    r.respira?.stop();
    setLido(true);
    Animated.sequence([
      Animated.timing(pulso, { toValue: 1.15, duration: r.reduz ? 0 : 120, useNativeDriver: true }),
      Animated.timing(pulso, { toValue: 1, duration: r.reduz ? 0 : 120, useNativeDriver: true }),
    ]).start();
    try {
      await onLido(data);
    } catch {
      setLido(false);
      volta();
    }
  };

  const onScan = (ev: BarcodeScanningResult) => {
    if (!tam || r.estado === "lido") return;
    const cru = pontos(ev);
    if (!cru || !valido(cru, tam.w, tam.h)) return;
    const p = expande(ordena(cru), 10), { rot: a, esc: e } = pose(p), agora = Date.now();
    clearTimeout(r.timer);
    r.timer = setTimeout(volta, 400); // perdeu o QR
    if (r.estado === "procurando") {
      r.estado = "travando";
      r.respira?.stop();
      pulso.setValue(1);
      r.data = ev.data; r.desde = agora;
      vai(p, a, e); // o "encaixe"
      return;
    }
    if (ev.data !== r.data) { r.data = ev.data; r.desde = agora; }
    // Redireciona só se andou >6dp e no máximo a cada 80ms: reiniciar mola no native driver dá um tranco.
    const andou = Math.max(...p.map((q, i) => Math.hypot(q.x - r.alvo[i].x, q.y - r.alvo[i].y)));
    if (andou > 6 && agora - r.mov > 80) vai(p, a, e);
    if (agora - r.desde >= 350) confirma(ev.data);
  };

  const cor = lido ? c.green : c.fg;
  const tamanho = Animated.multiply(esc, pulso);
  return (
    <View style={{ flex: 1 }} onLayout={({ nativeEvent: { layout } }) => setTam({ w: layout.width, h: layout.height })}>
      <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={lido ? undefined : onScan} />
      {tam && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {pos.map((v, i) => (
            <Animated.View key={i} style={{
              position: "absolute", left: 0, top: 0, width: BRACO, height: BRACO,
              borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8, borderColor: cor,
              transformOrigin: [0, 0, 0], // gira e escala em torno do vértice
              transform: [
                { translateX: v.x }, { translateY: v.y },
                { rotate: Animated.add(rot, BASE[i]).interpolate({ inputRange: [-360, 360], outputRange: ["-360deg", "360deg"] }) },
                { scale: tamanho },
              ],
            }} />
          ))}
        </View>
      )}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: "#000b" }}>
        <Text style={[s.muted, { textAlign: "center" }, !!erro && { color: c.red }]}>{erro || dica}</Text>
      </View>
    </View>
  );
}
