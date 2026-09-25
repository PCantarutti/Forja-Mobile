import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Vibration, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, G, Mask, Path, RadialGradient, Stop } from "react-native-svg";
import { PECAS } from "./aberturaPecas";
import { TEXTO } from "./Logo";
import { c } from "./tema";

// Abertura do app (a v2 aprovada em vídeo): o martelo sobe devagar, segura e desce de uma vez; no impacto a
// cena treme, a bigorna afunda, sai clarão + onda de choque e as faíscas explodem; o círculo fecha no sentido
// horário e o FORJA aparece. Mesmo roteiro do script que gerou o vídeo (quadro(t)), aqui dirigido pelo relógio.
const DUR = 3.1, T0 = 1.44, PIV = [318, 213] as const, IMP = [652, 496] as const;

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number) => x * x * x * x;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Ângulo do martelo: sobe devagar até -72°, segura com tremor, desce em 100 ms e repica. */
function angulo(t: number) {
  if (t < 0.15) return -8;
  if (t < 1.2) return -8 - 64 * easeInOut(seg(t, 0.15, 1.2));
  if (t < 1.34) return -72 - 1.5 * Math.sin(seg(t, 1.2, 1.34) * Math.PI);
  if (t < T0) return -72 * (1 - easeIn(seg(t, 1.34, T0)));
  const r = seg(t, T0, 1.75);
  return -11 * Math.sin(r * Math.PI) * Math.pow(1 - r, 0.6);
}
const gira = (a: number, dy = 0) => `rotate(${a} ${PIV[0]} ${PIV[1]}) translate(0 ${dy})`;

// Cena em coordenadas do logo (viewBox 228.5 137.5 802 718) com o FORJA embaixo: o texto (841×204 no
// original) entra com 58% da largura do logo, 60 unidades abaixo dele.
const TS = (802 * 0.58) / 841, TX = 629.5 - (211.5 + 420.5) * TS, TY = 855.5 + 60 - 882.5 * TS;
// O alto vai até y=-240: erguido a -72° o martelo passa do topo do logo (antes a cabeça sumia, cortada).
const VB = "150 -240 960 1380";

export default function Abertura({ onFim }: { onFim: () => void }) {
  const [t, setT] = useState(0);
  const saida = useRef(new Animated.Value(1)).current;
  const fim = useRef(false);
  const bateu = useRef(false);
  const { width, height } = useWindowDimensions();
  const acaba = () => {
    if (fim.current) return;
    fim.current = true;
    Animated.timing(saida, { toValue: 0, duration: 280, useNativeDriver: true }).start(onFim);
  };
  useEffect(() => {
    let raf = 0;
    const t0 = Date.now();
    const passo = () => {
      const s = (Date.now() - t0) / 1000;
      // Vibra uma vez no golpe: pancada forte (70 ms) e um toque curto no repique do martelo.
      if (s >= T0 && !bateu.current) { bateu.current = true; Vibration.vibrate([0, 70, 90, 25]); }
      setT(Math.min(s, DUR));
      if (s < DUR) raf = requestAnimationFrame(passo); else acaba();
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, []);

  const a = easeOut(seg(t, 0, 0.35));
  const imp = t >= T0 ? seg(t, T0, 1.72) : 0, dec = Math.pow(1 - imp, 2);
  const vivo = imp > 0 && imp < 1;
  const sx = vivo ? Math.sin(t * 95) * 14 * dec : 0, sy = vivo ? Math.cos(t * 120) * 10 * dec : 0;
  const afunda = vivo ? Math.sin(Math.min(1, imp * 2.2) * Math.PI) * 16 : 0;
  const ang = angulo(t);
  const golpe = t > 1.34 && t < T0 + 0.05;
  const fo = seg(t, T0, T0 + 0.28), oo = seg(t, T0, T0 + 0.5);
  const f = seg(t, T0, T0 + 0.55);
  const kf = f <= 0 ? 0 : f < 0.35 ? easeOut(f / 0.35) * 1.6 : 1.6 - 0.6 * easeInOut((f - 0.35) / 0.65);
  const circ = easeInOut(seg(t, 1.55, 2.45));
  const tx = easeOut(seg(t, 2.25, 2.75));
  const lado = Math.min(width, height) * 0.86;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: "center", justifyContent: "center", opacity: saida, zIndex: 100 }]}>
      <Pressable onPress={acaba} style={StyleSheet.absoluteFill} accessibilityLabel="Pular abertura" />
      <Svg width={lado} height={(lado * 1380) / 960} viewBox={VB} pointerEvents="none">
        <Defs>
          <Mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="2000" height="2000">
            <Circle cx={622} cy={514} r={357} fill="none" stroke="#fff" strokeWidth={80} transform="rotate(128 622 514)"
                    strokeDasharray={[2243, 2243]} strokeDashoffset={2243 * (1 - circ)} />
          </Mask>
          <RadialGradient id="brilho"><Stop offset="0" stopColor="#fff" stopOpacity={0.9} /><Stop offset="1" stopColor="#fff" stopOpacity={0} /></RadialGradient>
        </Defs>
        <G transform={`translate(${sx} ${sy})`}>
          <G mask="url(#m)"><Path fill="#ececec" d={PECAS.arcos} /></G>
          {t >= T0 && <Circle cx={IMP[0]} cy={IMP[1]} r={60 + 320 * easeOut(fo)} fill="url(#brilho)" opacity={0.55 * (1 - fo)} />}
          {t >= T0 && <Circle cx={IMP[0]} cy={IMP[1]} r={30 + 460 * easeOut(oo)} fill="none" stroke="#ececec" strokeWidth={14 * (1 - oo) + 1} opacity={0.7 * (1 - oo)} />}
          <Path fill="#ececec" d={PECAS.bigorna} opacity={a} transform={`translate(0 ${(1 - a) * 40 + afunda})`} />
          {kf > 0 && PECAS.faiscas.map((d, i) => (
            <Path key={i} fill="#ececec" d={d} opacity={clamp(f * 6)}
                  transform={`translate(${IMP[0]} ${IMP[1]}) scale(${kf}) translate(${-IMP[0]} ${-IMP[1]})`} />
          ))}
          {golpe && [1, 2, 3, 4].map((k) => (  // rastro do golpe: o martelo nos instantes de antes, cada vez mais apagado
            <Path key={k} fill="#ececec" fillRule="evenodd" d={PECAS.martelo} opacity={0.28 / k} transform={gira(angulo(t - k * 0.012))} />
          ))}
          <Path fill="#ececec" fillRule="evenodd" d={PECAS.martelo} opacity={easeOut(seg(t, 0.05, 0.3))} transform={gira(ang, afunda)} />
        </G>
        <Path fill="#ececec" fillRule="evenodd" d={TEXTO} opacity={tx} transform={`translate(${TX} ${TY + (1 - tx) * 16}) scale(${TS})`} />
      </Svg>
    </Animated.View>
  );
}
