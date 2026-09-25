import { useEffect, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "./api";
import { Chip, Fechar } from "./icones";
import { c, mono, s } from "./tema";

type Gpu = { nome: string; total: number; usado: number };
type Uso = {
  modelo: { alias: string; tamanho: number; ctx: number | null; uptime: number; ngl: number | null; cache: string } | null;
  carregando: { name: string; percent: number } | null;
  gpus: Gpu[];
  ram: { total: number; usado: number };
  gerando_imagem: boolean;
};

const gb = (b: number) => `${(b / 2 ** 30).toFixed(1).replace(".", ",")} GB`;
const tempo = (seg: number) => (seg < 3600 ? `${Math.max(1, Math.round(seg / 60))} min` : `${Math.floor(seg / 3600)} h ${Math.round((seg % 3600) / 60)} min`);
// Mesma régua do desktop (ModeloCarregado.tsx): verde até 70%, âmbar até 90%, vermelho acima.
const cor = (f: number) => (f < 0.7 ? c.green : f < 0.9 ? c.amber : c.red);

function Memoria({ rotulo, usado, total }: { rotulo: string; usado: number; total: number }) {
  const f = total ? Math.min(1, usado / total) : 0;
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={[s.txt, { flex: 1, fontSize: 14 }]} numberOfLines={1}>{rotulo}</Text>
        <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12 }}>{gb(usado)} de {gb(total)}</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
        <View style={{ width: `${f * 100}%`, height: "100%", borderRadius: 3, backgroundColor: cor(f), opacity: 0.85 }} />
      </View>
    </View>
  );
}

/** Botão do cabeçalho: ponto verde com modelo local no ar (âmbar carregando). O toque abre modelo e memória. */
export default function ModeloLocal({ estilo }: { estilo: object }) {
  const [uso, setUso] = useState<Uso | null>(null);
  const [aberto, setAberto] = useState(false);
  const [descarregando, setDescarregando] = useState(false);
  const inset = useSafeAreaInsets();

  async function descarregar() {
    setDescarregando(true);
    await api.post("/local/unload", {}).catch(() => {});
    setUso(await api.get<Uso>("/local/uso").catch(() => uso));
    setDescarregando(false);
  }

  useEffect(() => {
    const carrega = () => api.get<Uso>("/local/uso").then(setUso).catch(() => {});
    carrega();
    const t = setInterval(carrega, aberto ? 2500 : 10000);
    const sub = AppState.addEventListener("change", (st) => st === "active" && carrega());
    return () => { clearInterval(t); sub.remove(); };
  }, [aberto]);

  const m = uso?.modelo;
  const ponto = uso?.carregando ? c.amber : m ? c.green : c.faint;
  const titulo = uso?.carregando ? `Carregando… ${uso.carregando.percent}%` : m ? m.alias : "Nenhum modelo carregado";

  return (
    <>
      <Pressable onPress={() => setAberto(true)} hitSlop={6} style={estilo} accessibilityLabel="Modelo local e memória">
        <Chip size={19} color={m ? c.fg : c.muted} />
        <View style={{ position: "absolute", top: 9, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: ponto,
                       borderWidth: 1.5, borderColor: c.surface }} />
      </Pressable>
      <Modal visible={aberto} transparent animationType="slide" onRequestClose={() => setAberto(false)} statusBarTranslucent>
        <Pressable onPress={() => setAberto(false)} style={{ flex: 1, backgroundColor: "#000a", justifyContent: "flex-end" }}>
          <Pressable style={{ backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderColor: c.line,
                              borderWidth: 1, padding: 20, paddingBottom: 20 + inset.bottom, gap: 18 }}>
            <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.line, marginTop: -8 }} />
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
                <Chip size={19} color={c.muted} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ponto }} />
                  <Text style={{ color: c.fg, fontSize: 16.5, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>{titulo}</Text>
                </View>
                <Text style={s.muted}>
                  {m ? `IA local do PC · no ar há ${tempo(m.uptime)}` : uso?.carregando ? `Subindo ${uso.carregando.name}` : "IA local do PC · desligada"}
                </Text>
              </View>
              <Pressable onPress={() => setAberto(false)} hitSlop={10} accessibilityLabel="Fechar" style={{ padding: 4 }}>
                <Fechar size={20} color={c.muted} />
              </Pressable>
            </View>

            {!!m && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {([
                  ["Arquivo", m.tamanho ? gb(m.tamanho) : "—"],
                  ["Contexto", m.ctx ? `${m.ctx.toLocaleString("pt-BR")} tokens` : "—"],
                  ["Camadas na GPU", m.ngl == null ? "—" : m.ngl >= 999 ? "todas" : String(m.ngl)],
                  ["Cache KV", m.cache || "—"],
                ] as const).map(([k, v]) => (
                  <View key={k} style={{ width: "48.5%", backgroundColor: c.raised, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, gap: 2 }}>
                    <Text style={[s.faint, { fontSize: 11.5 }]}>{k}</Text>
                    <Text style={{ color: c.fg, fontSize: 14 }} numberOfLines={1}>{v}</Text>
                  </View>
                ))}
              </View>
            )}

            {!!uso && (
              <View style={{ gap: 14 }}>
                <Text style={s.secao}>Memória do PC</Text>
                {uso.gpus.map((g) => <Memoria key={g.nome} rotulo={g.nome} usado={g.usado} total={g.total} />)}
                <Memoria rotulo="RAM" usado={uso.ram.usado} total={uso.ram.total} />
                {uso.gerando_imagem && <Text style={{ color: c.sky, fontSize: 12.5 }}>Gerando imagem ou vídeo agora: a GPU está com o sd.cpp.</Text>}
              </View>
            )}

            {!!m && (
              <Pressable onPress={descarregar} disabled={descarregando}
                         style={{ alignItems: "center", paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: c.line,
                                  opacity: descarregando ? 0.5 : 1 }}>
                <Text style={{ color: c.fg, fontSize: 15 }}>{descarregando ? "Descarregando…" : "Descarregar modelo"}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
