import { Linking, ScrollView, Text, View } from "react-native";
import { c, mono } from "./tema";

// ponytail: Markdown mínimo (títulos, listas, citação, bloco de código, **negrito**, `código`, [link](url)).
// Tabela sai como texto monoespaçado. Trocar por uma lib se as respostas pedirem mais que isso.

const base = { color: c.fg, fontSize: 15, lineHeight: 23 };

function Inline({ texto, style }: { texto: string; style?: object }) {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <Text style={[base, style]} selectable>
      {partes.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**"))
          return <Text key={i} style={{ fontWeight: "700", color: "#fff" }}>{p.slice(2, -2)}</Text>;
        if (p.startsWith("`") && p.endsWith("`"))
          return <Text key={i} style={{ fontFamily: mono, color: c.inlineCode, backgroundColor: c.raised, fontSize: 13 }}> {p.slice(1, -1)} </Text>;
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link)
          return <Text key={i} style={{ color: c.link, textDecorationLine: "underline" }} onPress={() => Linking.openURL(link[2])}>{link[1]}</Text>;
        return p;
      })}
    </Text>
  );
}

// ponytail: realce por regex (comentário, string, número, palavra-chave, chamada, tag), com as cores do
// github-dark que o desktop usa (highlight.js). Não entende gramática: trocar por lowlight se precisar de precisão.
const COR_COD = { comentario: "#8b949e", string: "#a5d6ff", numero: "#79c0ff", chave: "#ff7b72", funcao: "#d2a8ff", tag: "#7ee787", attr: "#79c0ff" };
const CHAVES = new Set(("def class return if elif else for while in not and or is None True False import from as with try except finally raise " +
  "pass break continue lambda yield async await global nonlocal assert del function const let var new this typeof instanceof void null " +
  "undefined true false export default extends implements interface type enum public private protected static readonly switch case " +
  "throw catch do of echo fi then esac done local select where join insert update delete create table values into set").split(" "));
const TOKEN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(<\/?[A-Za-z][\w-]*)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$-]*)/g;

function realce(texto: string, lang: string) {
  const semHash = /^(js|jsx|ts|tsx|javascript|typescript|css|html|xml|json|java|c|cpp|cs|go|rust|swift|kotlin)$/.test(lang);
  const partes: React.ReactNode[] = [];
  let fim = 0;
  for (const m of texto.matchAll(TOKEN)) {
    const [tudo, coment, str, num, tag, fn, palavra] = m;
    if (coment && semHash && coment.startsWith("#")) continue; // '#' é comentário só em python/shell/yaml
    const cor = coment ? COR_COD.comentario : str ? COR_COD.string : num ? COR_COD.numero : tag ? COR_COD.tag
      : fn ? (CHAVES.has(fn) ? COR_COD.chave : COR_COD.funcao) : palavra && CHAVES.has(palavra) ? COR_COD.chave : null;
    if (!cor) continue;
    if (m.index! > fim) partes.push(texto.slice(fim, m.index));
    partes.push(<Text key={m.index} style={{ color: cor }}>{tudo}</Text>);
    fim = m.index! + tudo.length;
  }
  partes.push(texto.slice(fim));
  return partes;
}

export function Codigo({ texto, max, lang = "" }: { texto: string; max?: number; lang?: string }) {
  // Texto enorme (log, arquivo inteiro) sai sem realce: milhares de <Text> travam a lista.
  const conteudo = texto.length > 20000 ? texto : realce(texto, lang.toLowerCase());
  return (
    <ScrollView horizontal style={{ backgroundColor: c.code, borderColor: c.line, borderWidth: 1, borderRadius: 12, maxHeight: max }}
                contentContainerStyle={{ padding: 12 }}>
      <Text style={{ fontFamily: mono, fontSize: 12.5, lineHeight: 19, color: c.fg }} selectable>{conteudo}</Text>
    </ScrollView>
  );
}

/** Tabela do markdown: cabeçalho em negrito, linha "|---|" some, largura da coluna pelo texto mais longo. */
function Tabela({ linhas }: { linhas: string[] }) {
  const celulas = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
  const [cab, ...resto] = linhas.map(celulas);
  const corpo = resto.filter((r) => !r.every((x) => /^:?-+:?$/.test(x)));
  const larg = cab.map((_, j) => Math.min(220, Math.max(70, ...[cab, ...corpo].map((r) => (r[j] ?? "").length * 7.5 + 20))));
  const linha = (r: string[], k: number, negrito = false) => (
    <View key={k} style={{ flexDirection: "row", borderTopWidth: k ? 1 : 0, borderTopColor: c.line, backgroundColor: negrito ? c.raised : undefined }}>
      {cab.map((_, j) => (
        <View key={j} style={{ width: larg[j], padding: 8 }}>
          <Inline texto={r[j] ?? ""} style={{ fontSize: 13, lineHeight: 18, fontWeight: negrito ? "600" : undefined }} />
        </View>
      ))}
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ borderColor: c.line, borderWidth: 1, borderRadius: 10, overflow: "hidden" }}>
        {linha(cab, 0, true)}
        {corpo.map((r, k) => linha(r, k + 1))}
      </View>
    </ScrollView>
  );
}

export default function Markdown({ texto }: { texto: string }) {
  const blocos: React.ReactNode[] = [];
  const linhas = texto.replace(/\r/g, "").split("\n");
  let par: string[] = [];
  const fechaPar = () => {
    if (par.length) blocos.push(<Inline key={blocos.length} texto={par.join(" ")} />);
    par = [];
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.trimStart().startsWith("```")) {
      fechaPar();
      const lang = l.trim().slice(3).trim();
      const cod: string[] = [];
      while (++i < linhas.length && !linhas[i].trimStart().startsWith("```")) cod.push(linhas[i]);
      blocos.push(<Codigo key={blocos.length} texto={cod.join("\n")} lang={lang} />);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    const li = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    if (!l.trim()) fechaPar();
    else if (h) {
      fechaPar();
      blocos.push(<Inline key={blocos.length} texto={h[2]} style={{ fontWeight: "600", fontSize: [20, 18, 16, 15][h[1].length - 1] }} />);
    } else if (li) {
      fechaPar();
      const marca = /\d/.test(li[2]) ? li[2] : "•";
      blocos.push(
        <View key={blocos.length} style={{ flexDirection: "row", paddingLeft: 4 + Math.min(li[1].length, 8) * 4, gap: 8 }}>
          <Text style={[base, { color: c.muted }]}>{marca}</Text>
          <View style={{ flex: 1 }}><Inline texto={li[3]} /></View>
        </View>,
      );
    } else if (l.startsWith(">")) {
      fechaPar();
      blocos.push(
        <View key={blocos.length} style={{ borderLeftWidth: 3, borderLeftColor: c.line, paddingLeft: 10 }}>
          <Inline texto={l.replace(/^>\s?/, "")} style={{ color: c.muted }} />
        </View>,
      );
    } else if (l.trimStart().startsWith("|")) {
      fechaPar();
      const tab = [l];
      while (i + 1 < linhas.length && linhas[i + 1].trimStart().startsWith("|")) tab.push(linhas[++i]);
      blocos.push(<Tabela key={blocos.length} linhas={tab} />);
    } else par.push(l.trim());
  }
  fechaPar();
  return <View style={{ gap: 10 }}>{blocos}</View>;
}
