import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";

// Paleta do Forja Design System (_ds tokens/colors.css). O tema vale por aparelho (Configurações › Tema):
// ele troca os neutros e o acento; o `c` é mutado no lugar e a raiz do app remonta (App.tsx).
type Neutros = { bg: string; side: string; code: string; surface: string; raised: string; line: string; lineStrong: string;
  fg: string; fg2: string; muted: string; faint: string; accent: string; accentFg: string };
export const TEMAS: { id: string; nome: string; v: Neutros }[] = [
  { id: "forja", nome: "Forja", v: { bg: "#171717", side: "#0e0e0e", code: "#0d0d0d", surface: "#1f1f1f", raised: "#2a2a2a", line: "#2f2f2f",
    lineStrong: "#454545", fg: "#ececec", fg2: "#d4d4d4", muted: "#a3a3a3", faint: "#737373", accent: "#4f8ff7", accentFg: "#ffffff" } },
  { id: "brasa", nome: "Brasa", v: { bg: "#151311", side: "#100e0d", code: "#0f0d0c", surface: "#1d1a17", raised: "#26221f", line: "#2e2925",
    lineStrong: "#3a322b", fg: "#f0ebe5", fg2: "#cfc6bc", muted: "#aaa197", faint: "#7a7168", accent: "#f2a14a", accentFg: "#1a1208" } },
  { id: "aco", nome: "Aço", v: { bg: "#13161b", side: "#0d1014", code: "#0c0f13", surface: "#1a1e25", raised: "#222833", line: "#29303b",
    lineStrong: "#36404d", fg: "#eceff4", fg2: "#c7cdd6", muted: "#9ea7b4", faint: "#6c7584", accent: "#4aa3e8", accentFg: "#06121d" } },
  { id: "musgo", nome: "Musgo", v: { bg: "#121513", side: "#0d0f0e", code: "#0c0e0d", surface: "#191d1a", raised: "#212722", line: "#28302a",
    lineStrong: "#353f37", fg: "#ebf0ec", fg2: "#c6cfc8", muted: "#9ea9a0", faint: "#6d786f", accent: "#3fc3a3", accentFg: "#04160f" } },
  { id: "violeta", nome: "Violeta", v: { bg: "#15131a", side: "#0f0e13", code: "#0e0d12", surface: "#1c1a23", raised: "#25222e", line: "#2d2937",
    lineStrong: "#3a3547", fg: "#efedf3", fg2: "#cbc7d4", muted: "#a59fb2", faint: "#736d81", accent: "#a98bf5", accentFg: "#130a26" } },
  { id: "carmim", nome: "Carmim", v: { bg: "#161314", side: "#100e0e", code: "#0f0d0d", surface: "#1e1a1b", raised: "#282224", line: "#30292b",
    lineStrong: "#3e3437", fg: "#f1ecec", fg2: "#cfc6c7", muted: "#aa9fa1", faint: "#7a6f71", accent: "#e8546a", accentFg: "#1c0508" } },
];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** color-mix(accent p%, #fff) e o acento com transparência, como o colors.css calcula. */
const derivados = (accent: string) => {
  const [r, g, b] = hex(accent);
  const claro = [r, g, b].map((x) => Math.round(x * 0.7 + 255 * 0.3).toString(16).padStart(2, "0")).join("");
  return { accentText: `#${claro}`, accentSoft: `rgba(${r},${g},${b},0.12)`, accentLine: `rgba(${r},${g},${b},0.45)` };
};

const ESTADOS = {
  ok: "#5fd39a", err: "#e27a6b", info: "#6aa8e6", agent: "#b69ae6", warn: "#f2a14a",
  okSoft: "rgba(95,211,154,0.08)", errSoft: "rgba(226,122,107,0.08)", warnSoft: "rgba(242,161,74,0.07)",
  diffAdd: "#9fe3bf", diffDel: "#e9a095", inlineCode: "#f0a8a0", amber: "#fcd34d", amberLine: "#b45309", link: "#84b1f9",
};

const monta = (id: string) => {
  const v = (TEMAS.find((t) => t.id === id) ?? TEMAS[0]).v;
  // red/green/sky: nomes antigos, agora com os estados do design system
  return { ...v, ...derivados(v.accent), ...ESTADOS, red: ESTADOS.err, green: ESTADOS.ok, sky: ESTADOS.info, link: derivados(v.accent).accentText };
};

const lido = (() => { try { return JSON.parse(SecureStore.getItem("ajustes.aparencia") ?? "{}"); } catch { return {}; } })();
export let temaAtual: string = lido.tema ?? "forja";
export const c = monta(temaAtual);

// Fonte (Configurações › Tema): famílias embutidas pelo plugin do expo-font (app.json); "sistema" = a do Android.
export const FONTES = [
  { id: "atkinson", nome: "Atkinson + JetBrains", sans: "Atkinson", mono: "JetBrains Mono" },
  { id: "plex", nome: "IBM Plex", sans: "IBM Plex Sans", mono: "IBM Plex Mono" },
  { id: "sistema", nome: "Sistema", sans: undefined, mono: "monospace" },
];
export let fonteAtual: string = lido.fonte ?? "atkinson";
const fam = () => FONTES.find((f) => f.id === fonteAtual) ?? FONTES[0];
export let sans: string | undefined = fam().sans;
export let mono: string = fam().mono;

const estilos = () => ({
  tela: { flex: 1, backgroundColor: c.bg },
  txt: { color: c.fg, fontSize: 15, lineHeight: 23 },
  muted: { color: c.muted, fontSize: 13 },
  faint: { color: c.faint, fontSize: 13 },
  secao: { color: c.faint, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" as const },
  // Rótulo de seção CAIXA-ALTA mono ("ONDE", "HISTÓRICO", "FONTES · 14").
  secao2: { fontFamily: mono, fontSize: 10.5, fontWeight: "600" as const, letterSpacing: 0.84, color: c.faint },
  // Pílulas: primário no acento, secundário contornado.
  btn: { backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, alignItems: "center" as const,
         justifyContent: "center" as const, flexDirection: "row" as const, gap: 7 },
  btnTxt: { color: c.accentFg, fontSize: 15, fontWeight: "600" as const },
  btnSec: { borderColor: c.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, alignItems: "center" as const,
            justifyContent: "center" as const, flexDirection: "row" as const, gap: 7 },
  btnSecTxt: { color: c.fg, fontSize: 15 },
  input: { color: c.fg, backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 12,
           paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
});
export const s = StyleSheet.create(estilos());

/** Troca a fonte (vale ao remontar a raiz, como o tema). */
export function aplicaFonte(id: string) {
  fonteAtual = id; sans = fam().sans; mono = fam().mono;
  Object.assign(s, StyleSheet.create(estilos()));
  SecureStore.setItemAsync("ajustes.aparencia", JSON.stringify({ ...lido, tema: temaAtual, fonte: id })).catch(() => {});
}

/** Troca o tema: muta `c` e `s` no lugar e guarda no aparelho. Quem chama remonta a raiz (as telas releem `c`). */
export function aplicaTema(id: string) {
  temaAtual = id;
  Object.assign(c, monta(id));
  Object.assign(s, StyleSheet.create(estilos()));
  SecureStore.setItemAsync("ajustes.aparencia", JSON.stringify({ ...lido, tema: id, fonte: fonteAtual })).catch(() => {});
}
