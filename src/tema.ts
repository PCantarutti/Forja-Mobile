import { StyleSheet } from "react-native";

// Paleta do Forja Desktop (frontend/src/index.css, @theme).
export const c = {
  bg: "#171717", side: "#0e0e0e", surface: "#1f1f1f", raised: "#2a2a2a", line: "#2f2f2f",
  fg: "#ececec", muted: "#a3a3a3", faint: "#737373", code: "#0d0d0d", inlineCode: "#f0a8a0",
  amber: "#fcd34d", amberLine: "#b45309", red: "#f87171", green: "#4ade80", sky: "#38bdf8", link: "#93c5fd",
};

export const mono = "monospace";

export const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: c.bg },
  txt: { color: c.fg, fontSize: 15, lineHeight: 23 },
  muted: { color: c.muted, fontSize: 13 },
  faint: { color: c.faint, fontSize: 13 },
  secao: { color: c.faint, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" },
  // Botões pílula do desktop: primário branco, secundário contornado.
  btn: { backgroundColor: c.fg, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, alignItems: "center" },
  btnTxt: { color: "#000", fontSize: 15, fontWeight: "600" },
  btnSec: { borderColor: c.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10,
            alignItems: "center" },
  btnSecTxt: { color: c.fg, fontSize: 15 },
  input: { color: c.fg, backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 12,
           paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
});
