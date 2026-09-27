import Slider from "@react-native-community/slider";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Switch, View, useWindowDimensions,
         type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Abaixo, Check, Clock } from "./icones";
import { useTeclado } from "./teclado";
import { Text, TextInput } from "./Texto";
import { c, mono, s } from "./tema";

// Peças dos inputs (ajustes das telas), no visual do Forja Design System: folha inferior, chip, seletor,
// deslizador, cartões de opção e proporção, stepper, caixa de seleção, rádio, resumo da estimativa e toast.

/** Número no formato pt-BR (7,5 · 18,20 · 6,9). */
export const num = (x: number, casas?: number) => (casas == null ? String(x) : x.toFixed(casas)).replace(".", ",");
/** Rótulo de chip: mais de 14 caracteres corta em 13 + "…". */
export const corta = (t: string, n = 14) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const EASE = Easing.bezier(0.2, 0, 0, 1);

/** Base das folhas que sobem de baixo: o fundo escuro aparece com fade e só o painel desliza.
 * O Modal com animationType="slide" levava o fundo junto, subindo com o painel. A entrada começa no onShow:
 * animação nativa iniciada antes da view existir não pega (foi o que deixou a gaveta fora da tela). */
export function Deslizante({ aberta, onFecha, onVoltar, children }:
  { aberta: boolean; onFecha: () => void; onVoltar?: () => void; children: ReactNode }) {
  const { height } = useWindowDimensions();
  const [montada, setMontada] = useState(aberta);
  const a = useState(() => new Animated.Value(0))[0];
  const entra = () => Animated.timing(a, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  useEffect(() => {
    if (aberta) { if (montada) entra(); else setMontada(true); } // reabriu no meio da saída: só volta
    else if (montada) Animated.timing(a, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => finished && setMontada(false));
  }, [aberta]);
  return (
    <Modal visible={montada} transparent animationType="none" statusBarTranslucent onShow={entra} onRequestClose={onVoltar ?? onFecha}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000a", opacity: a }]}>
        <Pressable style={{ flex: 1 }} onPress={onFecha} />
      </Animated.View>
      <Animated.View pointerEvents="box-none"
                     style={[StyleSheet.absoluteFill, { justifyContent: "flex-end",
                       transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }]}>
        {children}
      </Animated.View>
    </Modal>
  );
}

/** Folha que sobe de baixo, com título; rola quando o conteúdo passa da altura. `fixo` fica entre o título e a rolagem. */
export function Folha({ aberta, titulo, onFecha, children, altura = "auto", fixo }:
  { aberta: boolean; titulo: string; onFecha: () => void; children: ReactNode; altura?: "auto" | `${number}%`; fixo?: ReactNode }) {
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  return (
    <Deslizante aberta={aberta} onFecha={onFecha}>
      <View style={{ maxHeight: "88%", height: altura === "auto" ? undefined : altura, backgroundColor: c.side, borderTopLeftRadius: 22,
                     borderTopRightRadius: 22, borderColor: c.line, borderWidth: 1, paddingBottom: Math.max(inset.bottom, teclado) + 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, paddingBottom: 12 }}>
          <Text style={{ color: c.fg, fontSize: 16, fontWeight: "600", flex: 1 }}>{titulo}</Text>
          <Pressable onPress={onFecha} hitSlop={10}><Text style={s.muted}>Fechar</Text></Pressable>
        </View>
        {fixo}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 18 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Deslizante>
  );
}

/** Pílula da linha de baixo do input (modelo, esforço, anexos…). `ativo` = ligado (acento suave). */
export function Chip({ rotulo, icone, onPress, ativo, cor, max = 132 }:
  { rotulo?: string; icone?: ReactNode; onPress: () => void; ativo?: boolean; cor?: string; max?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={4}
               style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 999,
                 height: 32, minWidth: 32, paddingHorizontal: rotulo ? 10 : 0, maxWidth: max, borderWidth: 1,
                 borderColor: ativo ? c.accentLine : "transparent",
                 backgroundColor: ativo ? c.accentSoft : pressed ? c.lineStrong : c.raised })}>
      {icone}
      {!!rotulo && <Text style={{ color: ativo ? c.accentText : cor ?? c.muted, fontSize: 13 }} numberOfLines={1}>{corta(rotulo)}</Text>}
    </Pressable>
  );
}

/** Rótulo + controle, numa linha dos ajustes. */
export function Campo({ rotulo, dica, direita, children }: { rotulo: string; dica?: string; direita?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={[s.muted, { flex: 1 }]}>{rotulo}</Text>
        {direita}
      </View>
      {children}
      {!!dica && <Text style={[s.faint, { fontSize: 12, lineHeight: 17 }]}>{dica}</Text>}
    </View>
  );
}

/** Escolha única entre poucas opções (linha de pílulas). `cheio`: cada uma com flex 1; `rolavel`: lista longa de lado. */
export function Seletor<T extends string>({ opcoes, valor, onMuda, cheio, rolavel, mono: emMono, altura }:
  { opcoes: { id: T; rotulo: string; off?: boolean }[]; valor: T; onMuda: (v: T) => void; cheio?: boolean; rolavel?: boolean; mono?: boolean;
    altura?: number }) {
  const itens = opcoes.map((o) => {
    const on = valor === o.id;
    return (
      <Pressable key={o.id} onPress={() => onMuda(o.id)}
                 style={{ height: altura ?? (rolavel ? 34 : 38), borderRadius: 999, paddingHorizontal: altura && altura < 32 ? 10 : 14,
                          alignItems: "center", justifyContent: "center",
                          backgroundColor: on ? c.accent : c.raised, opacity: o.off ? 0.35 : 1, flex: cheio ? 1 : undefined }}>
        <Text style={{ color: on ? c.accentFg : c.muted, fontSize: rolavel || emMono ? 12.5 : 13, textAlign: "center",
                       fontFamily: rolavel || emMono ? mono : undefined, fontWeight: on ? "600" : "400" }} numberOfLines={1}>{o.rotulo}</Text>
      </Pressable>
    );
  });
  if (rolavel)
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>{itens}</ScrollView>
    );
  return <View style={{ flexDirection: "row", flexWrap: cheio ? "nowrap" : "wrap", gap: 6 }}>{itens}</View>;
}

/** Slider com rótulo à esquerda e o valor mono à direita; pontas opcionais embaixo. */
export function Deslizador({ rotulo, valor, onMuda, min, max, passo = 1, casas, fmt, pontas, dica }: {
  rotulo: string; valor: number; onMuda: (n: number) => void; min: number; max: number; passo?: number; casas?: number;
  fmt?: (n: number) => string; pontas?: [string, string]; dica?: string;
}) {
  const [v, setV] = useState(valor); // o valor ao vivo enquanto arrasta; o pai só recebe ao soltar
  useEffect(() => setV(valor), [valor]);
  const arred = (n: number) => Math.round(Math.round(n / passo) * passo * 1000) / 1000;
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={[s.muted, { flex: 1 }]}>{rotulo}</Text>
        <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13 }}>{fmt ? fmt(v) : num(v, casas)}</Text>
      </View>
      <Slider style={{ height: 28, marginHorizontal: -10 }} minimumValue={min} maximumValue={max} step={passo} value={valor}
              onValueChange={(n) => setV(arred(n))} onSlidingComplete={(n) => onMuda(arred(n))}
              minimumTrackTintColor={c.accent} maximumTrackTintColor={c.lineStrong} thumbTintColor={c.accent} />
      {pontas && (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }}>{pontas[0]}</Text>
          <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }}>{pontas[1]}</Text>
        </View>
      )}
      {!!dica && <Text style={[s.faint, { fontSize: 12, lineHeight: 17, marginTop: 4 }]}>{dica}</Text>}
    </View>
  );
}

/** Cartão de escolha (predefinição, fator, método): título, sublinha e uma terceira linha opcional. */
export function CartaoOpcao({ titulo, sub, extra, on, onPress, altura = 72, estilo }: {
  titulo: string; sub?: string; extra?: string; on: boolean; onPress: () => void; altura?: number; estilo?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress}
               style={[{ flex: 1, borderRadius: 12, borderWidth: 1, padding: 10, minHeight: altura, gap: 2,
                         borderColor: on ? c.accentLine : c.line, backgroundColor: on ? c.accentSoft : c.surface }, estilo]}>
      <Text style={{ color: on ? c.fg : c.fg2, fontSize: 13.5, fontWeight: "600" }} numberOfLines={1}>{titulo}</Text>
      {!!sub && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }}>{sub}</Text>}
      {!!extra && <Text style={{ color: c.muted, fontFamily: mono, fontSize: 11 }}>{extra}</Text>}
    </Pressable>
  );
}

/** Cartão de proporção: o retângulo no formato real (lado maior 34), o rótulo e os px. */
export function CartaoProporcao({ rotulo, w, h, px, on, onPress, cheio }:
  { rotulo: string; w: number; h: number; px?: string; on: boolean; onPress: () => void; cheio?: boolean }) {
  const k = 34 / Math.max(w, h);
  const cor = on ? c.accentText : c.muted;
  return (
    <Pressable onPress={onPress}
               style={{ width: cheio ? undefined : 68, flex: cheio ? 1 : undefined, borderRadius: 12, borderWidth: 1, paddingTop: 10,
                        paddingHorizontal: 6, paddingBottom: 8, alignItems: "center", gap: 6,
                        borderColor: on ? c.accentLine : c.line, backgroundColor: on ? c.accentSoft : c.surface }}>
      <View style={{ height: 34, justifyContent: "center" }}>
        <View style={{ width: w * k, height: h * k, borderWidth: 1.5, borderRadius: 3, borderColor: cor }} />
      </View>
      <Text style={{ color: on ? c.accentText : c.fg2, fontSize: 13, fontWeight: "600" }}>{rotulo}</Text>
      {!!px && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 10.5 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{px}</Text>}
    </Pressable>
  );
}

/** Stepper: − valor +, limites e passo. `caixa`: variante com borda (largura e altura). */
export function Contador({ valor, onMuda, min, max, passo = 1, sufixo = "", caixa, fmt }: {
  valor: number; onMuda: (n: number) => void; min: number; max: number; passo?: number; sufixo?: string; caixa?: boolean;
  fmt?: (n: number) => string;
}) {
  const limita = (n: number) => Math.min(max, Math.max(min, Math.round(n / passo) * passo));
  const bt = { width: 40, height: 40, borderRadius: 20, backgroundColor: c.raised, alignItems: "center" as const, justifyContent: "center" as const };
  const simbolo = { color: c.fg, fontSize: 20, lineHeight: 22, textAlign: "center" as const, includeFontPadding: false };
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 6 },
                  caixa && { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: 12, height: 44, paddingHorizontal: 2 }]}>
      <Pressable style={[bt, { opacity: valor <= min ? 0.4 : 1 }]} disabled={valor <= min} onPress={() => onMuda(limita(valor - passo))}>
        <Text style={simbolo}>−</Text>
      </Pressable>
      <Text style={{ color: c.fg, fontFamily: mono, fontSize: 16, fontWeight: "600", minWidth: 48, textAlign: "center", flex: caixa ? 1 : undefined }}>
        {fmt ? fmt(valor) : num(valor)}{sufixo}
      </Text>
      <Pressable style={[bt, { opacity: valor >= max ? 0.4 : 1 }]} disabled={valor >= max} onPress={() => onMuda(limita(valor + passo))}>
        <Text style={simbolo}>+</Text>
      </Pressable>
    </View>
  );
}
export const Stepper = Contador;

/** Linha de ajuste com rótulo, sublinha e o controle à direita (Variações, Duração…). */
export function LinhaAjuste({ rotulo, sub, children }: { rotulo: string; sub?: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={s.muted}>{rotulo}</Text>
        {!!sub && <Text style={[s.faint, { fontSize: 12 }]}>{sub}</Text>}
      </View>
      {children}
    </View>
  );
}

/** Liga/desliga com texto. */
export function Opcao({ rotulo, dica, valor, onMuda, desabilitada, sub }:
  { rotulo: string; dica?: string; valor: boolean; onMuda: (v: boolean) => void; desabilitada?: boolean; sub?: string }) {
  return (
    <Pressable onPress={() => !desabilitada && onMuda(!valor)} style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: desabilitada ? 0.45 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.fg, fontSize: 14.5 }}>{rotulo}</Text>
        {!!sub && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{sub}</Text>}
        {!!dica && <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>{dica}</Text>}
      </View>
      <Switch value={valor} onValueChange={onMuda} disabled={desabilitada}
              trackColor={{ true: c.accent, false: c.lineStrong }} thumbColor={valor ? "#ffffff" : c.muted} />
    </Pressable>
  );
}

/** Lista de escolha única com descrição (menus do desktop: esforço, formato, modo…). `icone`: quadrado de 36 à esquerda. */
export function Lista<T extends string>({ opcoes, valor, onEscolhe }:
  { opcoes: { id: T; rotulo: string; dica?: string; cor?: string; icone?: ReactNode }[]; valor: T; onEscolhe: (v: T) => void }) {
  return (
    <View style={{ gap: 2, marginHorizontal: -8 }}>
      {opcoes.map((o) => (
        <Pressable key={o.id} onPress={() => onEscolhe(o.id)}
                   style={({ pressed }) => ({ padding: 12, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 12,
                     backgroundColor: o.id === valor ? c.raised : pressed ? c.surface : "transparent" })}>
          {!!o.icone && <Quadrado>{o.icone}</Quadrado>}
          <View style={{ flex: 1 }}>
            <Text style={[{ color: c.fg, fontSize: 15, lineHeight: 21 }, o.cor ? { color: o.cor } : null]}>{o.rotulo}</Text>
            {!!o.dica && <Text style={[s.muted, { lineHeight: 18 }]}>{o.dica}</Text>}
          </View>
          {o.id === valor && <Check size={17} color={c.accentText} />}
        </Pressable>
      ))}
    </View>
  );
}

/** Ícone num quadrado de 36 (raio 10, raised). */
export const Quadrado = ({ children, cor = c.raised, lado = 36 }: { children: ReactNode; cor?: string; lado?: number }) => (
  <View style={{ width: lado, height: lado, borderRadius: 10, backgroundColor: cor, alignItems: "center", justifyContent: "center" }}>{children}</View>
);

/** Caixa de seleção (lista de modelos): quadrado 20, nome e sublinha mono. */
export function Caixa({ rotulo, sub, on, onPress }: { rotulo: string; sub?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, padding: 10, borderRadius: 12,
                                          marginHorizontal: -10, backgroundColor: on ? c.raised : "transparent" }}>
      <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
                     borderColor: on ? c.accent : c.lineStrong, backgroundColor: on ? c.accent : "transparent" }}>
        {on && <Check size={14} color={c.accentFg} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.fg, fontSize: 14.5 }} numberOfLines={1}>{rotulo}</Text>
        {!!sub && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>{sub}</Text>}
      </View>
    </Pressable>
  );
}

/** Círculo de rádio (20, miolo 10 no acento). */
export const Bolinha = ({ on }: { on: boolean }) => (
  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: on ? c.accent : c.lineStrong,
                 alignItems: "center", justifyContent: "center" }}>
    {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }} />}
  </View>
);

/** Cartão de rádio: borda e fundo no acento quando ativo; `rodape` fica embaixo, fora do padding. */
export function Radio({ on, onPress, children, direita, rodape }:
  { on: boolean; onPress: () => void; children: ReactNode; direita?: ReactNode; rodape?: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={{ borderRadius: 12, borderWidth: 1, overflow: "hidden", borderColor: on ? c.accentLine : c.line,
                                          backgroundColor: on ? c.accentSoft : c.surface }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
        <Bolinha on={on} />
        <View style={{ flex: 1, gap: 3 }}>{children}</View>
        {direita}
      </View>
      {rodape}
    </Pressable>
  );
}

/** Selo pequeno (raio 5): texto 11 sobre fundo raised, ou mono com borda. */
export const Selo = ({ t, cor = c.faint, fundo = c.raised, borda, emMono }:
  { t: string; cor?: string; fundo?: string; borda?: boolean; emMono?: boolean }) => (
  <Text style={{ color: cor, fontSize: 11, fontFamily: emMono ? mono : undefined, backgroundColor: borda ? "transparent" : fundo,
                 borderWidth: borda ? 1 : 0, borderColor: c.line, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" }}
        numberOfLines={1}>{t}</Text>
);

/** Topo fixo das folhas de ajustes: resumo, tempo, barra de VRAM e o aviso quando passa da GPU. */
export function ResumoEstimativa({ linha, tempo, vram, gpu, estouro }:
  { linha: string; tempo: string | null; vram: number | null; gpu: number | null; estouro: string }) {
  const passa = vram != null && gpu != null && vram > gpu;
  return (
    <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
                   gap: 8, marginHorizontal: 16, marginBottom: 12 }}>
      <Text style={{ color: c.fg2, fontFamily: mono, fontSize: 12.5 }} numberOfLines={2}>{linha}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Clock size={13} color={c.muted} />
        <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12.5 }}>{tempo ?? "sem medição"}</Text>
        {vram != null && gpu != null ? (
          <>
            <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" }}>
              <View style={{ height: 4, width: `${Math.min(100, (vram / gpu) * 100)}%`, backgroundColor: passa ? c.warn : c.accent }} />
            </View>
            <Text style={{ color: passa ? c.warn : c.faint, fontFamily: mono, fontSize: 12 }}>{num(vram, 1)} de {num(gpu, 0)} GB</Text>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }} />
            {vram != null && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{num(vram, 1)} GB de VRAM</Text>}
          </>
        )}
      </View>
      {passa && <Text style={{ color: c.warn, fontSize: 12, lineHeight: 17 }}>{estouro}</Text>}
    </View>
  );
}

/** Seção recolhível (Avançado): cabeçalho com borda em cima, sublinha mono e o chevron que gira. */
export function Recolhivel({ titulo, sub, children, inicial = false }: { titulo: string; sub?: string; children: ReactNode; inicial?: boolean }) {
  const [aberto, setAberto] = useState(inicial);
  return (
    <View style={{ gap: 18 }}>
      <Pressable onPress={() => setAberto(!aberto)} style={{ flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1,
                                                              borderTopColor: c.line, paddingTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.fg, fontSize: 14.5, fontWeight: "600" }}>{titulo}</Text>
          {!!sub && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>{sub}</Text>}
        </View>
        <Gira aberto={aberto} size={18} />
      </Pressable>
      {aberto && children}
    </View>
  );
}

/** Chevron que gira 180° (seções recolhíveis). */
export function Gira({ aberto, size = 14, color = c.muted }: { aberto: boolean; size?: number; color?: string }) {
  const r = useState(() => new Animated.Value(aberto ? 1 : 0))[0];
  useEffect(() => { Animated.timing(r, { toValue: aberto ? 1 : 0, duration: 150, easing: EASE, useNativeDriver: true }).start(); }, [aberto]);
  return (
    <Animated.View style={{ transform: [{ rotate: r.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) }] }}>
      <Abaixo size={size} color={color} />
    </Animated.View>
  );
}

/** Ponto que pulsa enquanto roda (1 → 0,3 → 1 em 1,2 s); parado com "reduzir movimento". */
export function Pulsa({ cor, lado = 7, ativo = true }: { cor: string; lado?: number; ativo?: boolean }) {
  const o = useState(() => new Animated.Value(1))[0];
  useEffect(() => {
    if (!ativo) return;
    let loop: Animated.CompositeAnimation | null = null;
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduz) => {
      if (reduz || !vivo) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(o, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(o, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]));
      loop.start();
    });
    return () => { vivo = false; loop?.stop(); o.setValue(1); };
  }, [ativo]);
  return <Animated.View style={{ width: lado, height: lado, borderRadius: lado / 2, backgroundColor: cor, opacity: o }} />;
}

/** Botão pílula com ícone (ações de lote, cartões). `primario` = acento. */
export function Botao({ rotulo, icone, onPress, primario, altura = 38, desabilitado, cor, flex, estilo }: {
  rotulo: string; icone?: ReactNode; onPress: () => void; primario?: boolean; altura?: number; desabilitado?: boolean; cor?: string;
  flex?: boolean; estilo?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={desabilitado}
               style={({ pressed }) => [{ height: altura, borderRadius: 999, paddingHorizontal: 14, flexDirection: "row", alignItems: "center",
                 justifyContent: "center", gap: 7, opacity: desabilitado ? 0.4 : 1, flex: flex ? 1 : undefined,
                 borderWidth: primario ? 0 : 1, borderColor: c.line,
                 backgroundColor: primario ? c.accent : pressed ? c.raised : "transparent" }, estilo]}>
      {icone}
      <Text style={{ color: primario ? c.accentFg : cor ?? c.fg, fontSize: altura >= 44 ? 15 : 13.5, fontWeight: primario ? "600" : "400" }}
            numberOfLines={1}>{rotulo}</Text>
    </Pressable>
  );
}

/** Botão só de ícone, sempre centralizado. */
export function BotaoIcone({ children, onPress, lado = 36, fundo = c.raised, borda, desabilitado, estilo }: {
  children: ReactNode; onPress: () => void; lado?: number; fundo?: string; borda?: string; desabilitado?: boolean; estilo?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={desabilitado} hitSlop={4}
               style={[{ width: lado, height: lado, borderRadius: lado / 2, backgroundColor: fundo, alignItems: "center", justifyContent: "center",
                         borderWidth: borda ? 1 : 0, borderColor: borda, opacity: desabilitado ? 0.25 : 1 }, estilo]}>
      {children}
    </Pressable>
  );
}

// Toast: confirmações que antes abriam um diálogo só com "Ok". Montado uma vez na raiz (App.tsx).
type PedidoToast = { texto: string; desfazer?: () => void; n: number };
let mostraToast: ((p: PedidoToast) => void) | null = null;
let seq = 0;
export function toast(texto: string, desfazer?: () => void) { mostraToast?.({ texto, desfazer, n: ++seq }); }

export function Toasts() {
  const [p, setP] = useState<PedidoToast | null>(null);
  const o = useState(() => new Animated.Value(0))[0];
  const inset = useSafeAreaInsets();
  useEffect(() => { mostraToast = setP; return () => { mostraToast = null; }; }, []);
  useEffect(() => {
    if (!p) return;
    Animated.timing(o, { toValue: 1, duration: 150, easing: EASE, useNativeDriver: true }).start();
    const t = setTimeout(() => Animated.timing(o, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setP(null)),
                         p.desfazer ? 3500 : 2600);
    return () => clearTimeout(t);
  }, [p?.n]);
  if (!p) return null;
  return (
    <Animated.View pointerEvents="box-none" style={{ position: "absolute", left: 16, right: 16, bottom: 24 + inset.bottom, opacity: o }}>
      <View style={{ backgroundColor: c.raised, borderColor: c.lineStrong, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
                     flexDirection: "row", alignItems: "center", gap: 10, elevation: 12, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 15,
                     shadowOffset: { width: 0, height: 10 } }}>
        <Check size={16} color={c.ok} />
        <Text style={{ color: c.fg, fontSize: 13, flex: 1, lineHeight: 18 }}>{p.texto}</Text>
        {p.desfazer && (
          <Pressable hitSlop={10} onPress={() => { p.desfazer?.(); setP(null); }}>
            <Text style={{ color: c.accentText, fontSize: 13, fontWeight: "600" }}>Desfazer</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

/** Campo de texto multilinha no padrão das folhas (raio 12). */
export const Area = ({ valor, onMuda, placeholder, linhas = 2, emMono }:
  { valor: string; onMuda: (t: string) => void; placeholder?: string; linhas?: number; emMono?: boolean }) => (
  <TextInput style={[s.input, { minHeight: 20 * linhas + 18, textAlignVertical: "top", fontFamily: emMono ? mono : undefined, fontSize: emMono ? 13 : 15 }]}
             value={valor} onChangeText={onMuda} multiline placeholder={placeholder} placeholderTextColor={c.faint} />
);
