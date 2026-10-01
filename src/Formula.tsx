import { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import katex from "katex";
import { marked } from "marked";
import Markdown from "./Markdown";
import { c, mono } from "./tema";
import { KATEX_CSS } from "./katexAssets";

// Texto de estudo com fórmula ($...$, $$...$$): o celular não tem KaTeX nativo, então o Markdown vira HTML aqui
// (marked + katex rodam no JS do app, sem DOM) e uma WebView só desenha, com o CSS e as fontes do KaTeX
// embutidos — sem rede, mesma cara do desktop. Texto sem fórmula continua no Markdown nativo, que é mais leve.

export const temFormula = (t: string) => /\$|\\\(|\\\[/.test(t);

/** O mesmo normalizador do desktop (estudosTexto.ts): \( \) e \[ \] viram $; "R$ 10" não vira fórmula. */
export function matematica(texto: string) {
  return texto.replace(/\\\[([\s\S]+?)\\\]/g, (_, f) => `$$${f}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, f) => `$${f}$`)
    .replace(/R\$(?=\s?\d)/g, "R\\$");
}

const BLOCO = /\$\$([\s\S]+?)\$\$/g;
const EM_LINHA = /(?<![\w\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$/g;

/** Markdown com fórmulas → HTML: as fórmulas saem antes (placeholders), o marked cuida do resto, o KaTeX entra no fim. */
export function paraHtml(markdown: string): string {
  const formulas: string[] = [];
  const guarda = (tex: string, bloco: boolean) => {
    // o modelo escreve "10 m" com espaço estreito (U+202F/U+00A0), que o KaTeX não conhece
    const limpo = tex.replace(/[  ]/g, " ");
    formulas.push(katex.renderToString(limpo, { displayMode: bloco, throwOnError: false, output: "html" }));
    return `\u0000F${formulas.length - 1}\u0000`;
  };
  const texto = matematica(markdown).replace(BLOCO, (_, f) => guarda(f, true)).replace(EM_LINHA, (_, f) => guarda(f, false));
  const html = marked.parse(texto, { async: false, gfm: true, breaks: false }) as string;
  return html.replace(/\u0000F(\d+)\u0000/g, (_, i) => formulas[Number(i)]);
}

/** CSS da página: o tema do app (as cores vêm de c.*) + o do KaTeX. `fundo` é a cor do cartão onde a WebView mora. */
function estilo(fundo: string, tamanho: number, margem: number) {
  return `${KATEX_CSS}
html,body{margin:0;padding:0;background:${fundo};color:${c.fg}}
.md{padding:${margem ? `12px ${margem}px 32px` : "0"}}
body{font-family:system-ui,Roboto,-apple-system,sans-serif;font-size:${tamanho}px;line-height:1.55;overflow-wrap:anywhere;-webkit-text-size-adjust:100%}
.md>*:first-child{margin-top:0}.md>*:last-child{margin-bottom:0}
p,ul,ol,blockquote,pre,table{margin:0 0 .75em}
h1,h2,h3,h4{font-weight:600;line-height:1.3;margin:1.2em 0 .5em}h1{font-size:1.35em}h2{font-size:1.18em;border-bottom:1px solid ${c.line};padding-bottom:.25em}h3{font-size:1.06em}
ul,ol{padding-left:1.4em}li+li{margin-top:.3em}
strong{color:${c.fg};font-weight:600}a{color:${c.accentText}}
code{font-family:${mono},monospace;background:${c.raised};color:${c.accentText};padding:.1em .35em;border-radius:5px;font-size:.88em}
pre{background:${c.code};border:1px solid ${c.line};border-radius:12px;padding:.9em 1em;overflow-x:auto;font-size:.85em}pre code{background:transparent;padding:0;color:${c.fg}}
blockquote{border-left:3px solid ${c.line};margin-left:0;padding-left:.8em;color:${c.muted}}
table{border-collapse:collapse;width:100%;font-size:.92em;display:block;overflow-x:auto}th,td{border-bottom:1px solid ${c.line};padding:.45em .7em;text-align:left;vertical-align:top}th{background:${c.raised}}
hr{border:0;border-top:1px solid ${c.line}}
.katex-display{overflow-x:auto;overflow-y:hidden;padding:.2em 0;margin:.6em 0}
.katex{font-size:1.06em}
img{max-width:100%}
#explicar{position:absolute;display:none;z-index:9;background:${c.accent};color:${c.accentFg};border:0;border-radius:9px;padding:7px 11px;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35)}
`;
}

// A página avisa a altura (para a WebView encaixar no cartão) e, no documento inteiro, o trecho marcado.
const SCRIPT = `<script>(function(){
  var rn=window.ReactNativeWebView;function altura(){rn.postMessage(JSON.stringify({tipo:"altura",h:Math.ceil(document.body.getBoundingClientRect().height)}))}
  addEventListener("load",altura);new ResizeObserver(altura).observe(document.body);
  var b=document.getElementById("explicar");
  if(b){document.addEventListener("selectionchange",function(){var s=getSelection(),t=s?String(s).trim():"";
      if(t.length<12||!s.rangeCount){b.style.display="none";return}
      var r=s.getRangeAt(0).getBoundingClientRect();b.style.display="block";
      b.style.left=Math.max(8,Math.min(innerWidth-b.offsetWidth-8,r.left+scrollX+r.width/2-b.offsetWidth/2))+"px";
      b.style.top=Math.max(8,r.top+scrollY-44)+"px"});
    b.addEventListener("click",function(){var t=String(getSelection()).trim();getSelection().removeAllRanges();b.style.display="none";
      rn.postMessage(JSON.stringify({tipo:"explicar",trecho:t.slice(0,1500)}))});}
  window.__forja={ir:function(i){var h=document.querySelectorAll("h2")[i];h&&h.scrollIntoView({behavior:"smooth",block:"start"})}};
})();</script>`;
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob: https:; font-src data:">`;

function pagina(html: string, fundo: string, tamanho: number, explicar: boolean, margem = 0) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${CSP}<style>${estilo(fundo, tamanho, margem)}</style></head>` +
    `<body><div class="md">${html}</div>${explicar ? '<button id="explicar" type="button">Explicar de outro jeito</button>' : ""}${SCRIPT}</body></html>`;
}

type Msg = { tipo: "altura"; h: number } | { tipo: "explicar"; trecho: string };

/** Um trecho (enunciado, alternativa, explicação, cartão) que encaixa no cartão nativo: sem fórmula vai no
 *  Markdown do app; com fórmula, uma WebView da altura exata do conteúdo. */
export const TextoRico = memo(function TextoRico({ texto, fundo = c.surface, tamanho = 15 }: { texto: string; fundo?: string; tamanho?: number }) {
  if (!temFormula(texto)) return <Markdown texto={texto} />;
  return <FormulaWeb texto={texto} fundo={fundo} tamanho={tamanho} />;
});

function FormulaWeb({ texto, fundo, tamanho }: { texto: string; fundo: string; tamanho: number }) {
  const [altura, setAltura] = useState(28);
  const html = useMemo(() => pagina(paraHtml(texto), fundo, tamanho, false), [texto, fundo, tamanho]);
  return (
    <View style={{ height: altura, overflow: "hidden" }}>
      <WebView originWhitelist={["*"]} source={{ html }} style={{ height: altura, backgroundColor: fundo }} scrollEnabled={false}
               showsVerticalScrollIndicator={false} overScrollMode="never"
               onMessage={(e) => { const m: Msg = JSON.parse(e.nativeEvent.data || "{}"); if (m.tipo === "altura" && m.h > 0) setAltura(m.h); }} />
    </View>
  );
}

export type DocumentoRef = { irPara: (i: number) => void };

/** O resumo inteiro: uma WebView que rola por dentro (um resumo de 15 páginas numa WebView dentro do ScrollView
 *  passava do limite de altura do Android). Marcar um trecho mostra "Explicar de outro jeito". */
export const DocumentoRico = forwardRef<DocumentoRef, { markdown: string; onExplicar?: (trecho: string) => void }>(function DocumentoRico({ markdown, onExplicar }, ref) {
  const web = useRef<WebView>(null);
  const html = useMemo(() => pagina(paraHtml(markdown), c.bg, 15.5, !!onExplicar, 16), [markdown, onExplicar]);
  useImperativeHandle(ref, () => ({ irPara: (i) => web.current?.injectJavaScript(`window.__forja && __forja.ir(${i}); true;`) }), []);
  return (
    <WebView ref={web} originWhitelist={["*"]} source={{ html }} style={{ flex: 1, backgroundColor: c.bg }} overScrollMode="never"
             onMessage={(e) => { const m: Msg = JSON.parse(e.nativeEvent.data || "{}"); if (m.tipo === "explicar" && m.trecho) onExplicar?.(m.trecho); }} />
  );
});

/** Os títulos "## " do resumo, para o sumário (o mesmo do desktop, estudosTexto.ts). */
export function sumario(md: string): string[] {
  const out: string[] = [];
  let codigo = false;
  for (const l of md.split("\n")) {
    if (l.trimStart().startsWith("```")) codigo = !codigo;
    else if (!codigo && /^## /.test(l)) out.push(l.slice(3).trim());
  }
  return out;
}
