import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTeclado } from "./teclado";
import { c, s } from "./tema";

// Peças dos inputs (ajustes das telas), no visual do app: folha inferior, chip, seletor, contador, opção.

/** Base das folhas que sobem de baixo: o fundo escuro aparece com fade e só o painel desliza.
 * O Modal com animationType="slide" levava o fundo junto, subindo com o painel. A entrada começa no onShow:
 * animação nativa iniciada antes da view existir não pega (foi o que deixou a gaveta fora da tela). */
export function Deslizante({ aberta, onFecha, onVoltar, children }:
  { aberta: boolean; onFecha: () => void; onVoltar?: () => void; children: ReactNode }) {
  const { height } = useWindowDimensions();
  const [montada, setMontada] = useState(aberta);
  const a = useRef(new Animated.Value(0)).current;
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

/** Folha que sobe de baixo, com título; rola quando o conteúdo passa da altura. */
export function Folha({ aberta, titulo, onFecha, children, altura = "auto" }:
  { aberta: boolean; titulo: string; onFecha: () => void; children: ReactNode; altura?: "auto" | `${number}%` }) {
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  return (
    <Deslizante aberta={aberta} onFecha={onFecha}>
      <View style={{ maxHeight: "88%", height: altura === "auto" ? undefined : altura, backgroundColor: c.side, borderTopLeftRadius: 22,
                     borderTopRightRadius: 22, borderColor: c.line, borderWidth: 1, paddingBottom: Math.max(inset.bottom, teclado) + 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, paddingBottom: 8 }}>
          <Text style={{ color: c.fg, fontSize: 16, fontWeight: "600", flex: 1 }}>{titulo}</Text>
          <Pressable onPress={onFecha} hitSlop={10}><Text style={s.muted}>Fechar</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 14 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Deslizante>
  );
}

/** Pílula da linha de baixo do input (modelo, esforço, anexos…). `ativo` destaca. */
export function Chip({ rotulo, icone, onPress, ativo, cor, max = 170 }:
  { rotulo: string; icone?: ReactNode; onPress: () => void; ativo?: boolean; cor?: string; max?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={4}
               style={{ flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
                        backgroundColor: ativo ? c.fg : c.raised, maxWidth: max }}>
      {icone}
      <Text style={{ color: ativo ? "#000" : cor ?? c.muted, fontSize: 13 }} numberOfLines={1}>{rotulo}</Text>
    </Pressable>
  );
}

/** Rótulo + controle, numa linha dos ajustes. */
export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.muted}>{rotulo}</Text>
      {children}
      {!!dica && <Text style={[s.faint, { fontSize: 12 }]}>{dica}</Text>}
    </View>
  );
}

/** Escolha única entre poucas opções (vira linha de pílulas). */
export function Seletor<T extends string>({ opcoes, valor, onMuda }: { opcoes: { id: T; rotulo: string }[]; valor: T; onMuda: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {opcoes.map((o) => (
        <Pressable key={o.id} onPress={() => onMuda(o.id)}
                   style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: valor === o.id ? c.fg : c.raised }}>
          <Text style={{ color: valor === o.id ? "#000" : c.muted, fontSize: 13 }}>{o.rotulo}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Número com − / +, limites e passo; o meio aceita digitar. */
export function Contador({ valor, onMuda, min, max, passo = 1, sufixo = "" }:
  { valor: number; onMuda: (n: number) => void; min: number; max: number; passo?: number; sufixo?: string }) {
  const limita = (n: number) => Math.min(max, Math.max(min, Math.round(n / passo) * passo));
  const bt = { width: 38, height: 38, borderRadius: 19, backgroundColor: c.raised, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable style={bt} onPress={() => onMuda(limita(valor - passo))}><Text style={s.txt}>−</Text></Pressable>
      <TextInput style={[s.input, { width: 90, textAlign: "center", paddingVertical: 6 }]} keyboardType="numeric"
                 value={String(valor)} onChangeText={(t) => { const n = Number(t.replace(",", ".")); if (!Number.isNaN(n)) onMuda(n); }}
                 onEndEditing={() => onMuda(limita(valor))} />
      <Pressable style={bt} onPress={() => onMuda(limita(valor + passo))}><Text style={s.txt}>+</Text></Pressable>
      {!!sufixo && <Text style={s.muted}>{sufixo}</Text>}
    </View>
  );
}

/** Liga/desliga com texto. */
export function Opcao({ rotulo, dica, valor, onMuda }: { rotulo: string; dica?: string; valor: boolean; onMuda: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onMuda(!valor)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={s.txt}>{rotulo}</Text>
        {!!dica && <Text style={[s.faint, { fontSize: 12 }]}>{dica}</Text>}
      </View>
      <Switch value={valor} onValueChange={onMuda} trackColor={{ true: c.fg, false: c.raised }} thumbColor={valor ? "#000" : c.muted} />
    </Pressable>
  );
}

/** Lista de escolha única com descrição (menus do desktop: esforço, formato, modo…). */
export function Lista<T extends string>({ opcoes, valor, onEscolhe }:
  { opcoes: { id: T; rotulo: string; dica?: string; cor?: string }[]; valor: T; onEscolhe: (v: T) => void }) {
  return (
    <View style={{ gap: 2, marginHorizontal: -8 }}>
      {opcoes.map((o) => (
        <Pressable key={o.id} onPress={() => onEscolhe(o.id)}
                   style={{ padding: 12, borderRadius: 12, backgroundColor: o.id === valor ? c.raised : "transparent" }}>
          <Text style={[s.txt, o.cor ? { color: o.cor } : null]}>{o.rotulo}</Text>
          {!!o.dica && <Text style={s.muted}>{o.dica}</Text>}
        </Pressable>
      ))}
    </View>
  );
}
