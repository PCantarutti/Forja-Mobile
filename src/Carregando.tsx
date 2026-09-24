import { useEffect, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, base } from "./api";
import { c, s } from "./tema";

type Carga = { name: string; percent: number; elapsed: number; eta: number };

/** Modelo subindo no PC (em qualquer tela, como o LocalLoading do desktop): nome, %, tempo e cancelar.
 * O llama.cpp não publica %: é tempo decorrido sobre o estimado (localai._progress). */
export default function CarregandoModelo() {
  const [carga, setCarga] = useState<Carga | null>(null);
  const [ativo, setAtivo] = useState(AppState.currentState === "active");
  const inset = useSafeAreaInsets();
  const consulta = () => {
    if (!base()) return; // ainda sem pareamento
    api.get<{ loading: Partial<Carga> }>("/local/carregando", 5000)
      .then((r) => setCarga(r.loading?.percent != null ? (r.loading as Carga) : null)).catch(() => {});
  };
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => setAtivo(st === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!ativo) return; // em segundo plano não consulta (bateria)
    consulta();
    const t = setInterval(consulta, 2500);
    return () => clearInterval(t);
  }, [ativo]);
  if (!carga) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: inset.top + 64, alignItems: "center" }}>
      <View style={{ width: "88%", backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 16, padding: 12, gap: 8,
                     elevation: 8, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>Carregando {carga.name}</Text>
          <Text style={s.muted}>{carga.percent}%</Text>
        </View>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
          <View style={{ height: 5, width: `${carga.percent}%`, backgroundColor: c.sky }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[s.faint, { flex: 1, fontSize: 12 }]}>{carga.elapsed}s de ~{carga.eta}s estimados</Text>
          <Pressable hitSlop={8} onPress={() => api.post("/local/cancel-load").then(consulta).catch(() => {})}>
            <Text style={[s.faint, { fontSize: 12, textDecorationLine: "underline" }]}>cancelar</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
