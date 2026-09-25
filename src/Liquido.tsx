import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { c } from "./tema";

/** O líquido do desktop (ImagensView `Liquido`): o nível sobe com o progresso (1 s, desacelerando) e a crista em onda
 *  corre sem parar (2,4 s por volta). Para o card que gera sem prévia ao vivo. Com "reduzir movimento" no sistema,
 *  a onda fica parada. `largura`: a do card, que a onda precisa para dar a volta inteira. */
export default function Liquido({ fracao, largura }: { fracao: number; largura: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  // valores animados estáveis entre renders (o useState com inicializador, que o React Compiler aceita no render)
  const [nivel] = useState(() => new Animated.Value(Math.max(pct, 4)));
  const [onda] = useState(() => new Animated.Value(0));
  const [quieto, setQuieto] = useState(false);

  useEffect(() => {
    Animated.timing(nivel, { toValue: Math.max(pct, 4), duration: 1000, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [pct, nivel]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setQuieto).catch(() => {});
  }, []);
  useEffect(() => {
    if (quieto) return;
    const volta = Animated.loop(Animated.timing(onda, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    volta.start();
    return () => volta.stop();
  }, [quieto, onda]);

  return (
    // Cor sólida por dentro e a transparência no grupo, como no desktop: crista e corpo se sobrepõem 1 px e, cada
    // um semitransparente, a sobreposição aparecia como uma linha mais escura.
    <Animated.View pointerEvents="none" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, opacity: 0.25,
               height: nivel.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }}>
      <View style={{ flex: 1, backgroundColor: c.sky }} />
      <View style={{ position: "absolute", top: -9, left: 0, width: largura, height: 10, overflow: "hidden" }}>
        <Animated.View style={{ width: largura * 2, height: 10,
                                transform: [{ translateX: onda.interpolate({ inputRange: [0, 1], outputRange: [0, -largura] }) }] }}>
          <Svg width={largura * 2} height={10} viewBox="0 0 200 10" preserveAspectRatio="none">
            <Path d="M0 5 Q 25 0 50 5 T 100 5 T 150 5 T 200 5 V 10 H 0 Z" fill={c.sky} />
          </Svg>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
