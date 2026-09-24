import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { c, s } from "./tema";

// Confirmação com o visual do Forja, no lugar do Alert do sistema (que é do Android, não do app).
type Botao = { texto: string; estilo?: "cancelar" | "perigo"; acao?: () => void };
type Pedido = { titulo: string; msg: string; botoes: Botao[] };

let mostra: ((p: Pedido) => void) | null = null;

/** Mesmo uso do Alert.alert: `pergunta("Título", "texto", [{ texto: "Cancelar", estilo: "cancelar" }, { texto: "Ok", acao }])`. */
export function pergunta(titulo: string, msg: string, botoes: Botao[]) {
  mostra?.({ titulo, msg, botoes });
}

/** Montado uma vez na raiz do app; é quem desenha o diálogo pedido por `pergunta`. */
export function Dialogos() {
  const [p, setP] = useState<Pedido | null>(null);
  useEffect(() => {
    mostra = setP;
    return () => { mostra = null; };
  }, []);
  if (!p) return null;
  const toca = (b: Botao) => { setP(null); b.acao?.(); };
  const cancelar = p.botoes.find((b) => b.estilo === "cancelar");
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => (cancelar ? toca(cancelar) : setP(null))} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: "#000b", justifyContent: "center", padding: 28 }}
                 onPress={() => (cancelar ? toca(cancelar) : setP(null))}>
        <Pressable style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 22, padding: 20, gap: 12 }}>
          <Text style={{ color: c.fg, fontSize: 17, fontWeight: "600" }}>{p.titulo}</Text>
          {!!p.msg && <Text style={[s.muted, { fontSize: 14.5, lineHeight: 21 }]}>{p.msg}</Text>}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {p.botoes.map((b) => (
              <Pressable key={b.texto} onPress={() => toca(b)}
                         style={b.estilo === "cancelar" ? s.btnSec : [s.btn, b.estilo === "perigo" && { backgroundColor: c.red }]}>
                <Text style={b.estilo === "cancelar" ? s.btnSecTxt : s.btnTxt}>{b.texto}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
