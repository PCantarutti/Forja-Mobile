import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "./Texto";
import { api, lerAjustes, salvaAjustes, streamSSE } from "./api";
import type { Conv } from "./Chat";
import { Balao, Check, Undo, X } from "./icones";
import { BotaoEnviar } from "./Imagens";
import Markdown from "./Markdown";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Botao, Chip, toast } from "./ui";

// Tela Design do Forja Desktop (DesignView), no celular: ver o design da versão atual, conversar com a IA,
// aprovar o plano, responder as perguntas e — o principal aqui — comentar tocando num elemento. Tudo vai
// pelas mesmas rotas /api/design do PC, e o /activity mantém os dois lados iguais, ao vivo.

type Msg = {
  id: number; role: "user" | "assistant"; content: string; status: string | null; versao: number | null;
  mensagem?: string; sugestoes?: string[]; passos?: string[]; plano?: { tipo: string; secoes: { nome: string }[] } | null;
  perguntas?: { pergunta: string; opcoes: string[] }[] | null;
};
type Comentario = { id: number; texto: string; fids: string[]; status: string; orfao: boolean };
type Projeto = { conv_id: number; titulo: string; mensagens: Msg[]; total: number; atual: number; html: string;
                 comentarios: Comentario[]; rodando: number | null };
type Geracao = { message_id: number; status: string; modo?: string; secoes?: { nome: string; status: string }[] };

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:">`;
// Inspetor de toque (o do PC é de mouse): no modo comentar, o toque escolhe o elemento em vez de clicar nele.
const INSPETOR = `<script>(function () {
  var comentar = false, sel = null, pins = [];
  var camada = document.createElement("div");
  camada.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:2147483647";
  function alvo(el) { while (el && el.nodeType === 1 && !el.hasAttribute("data-fid")) el = el.parentElement;
    return el && el !== document.documentElement && el !== document.body ? el : null; }
  function rotulo(el) { var k = (el.getAttribute("class") || "").trim().split(/\\s+/)[0]; return el.tagName.toLowerCase() + (k ? "." + k : ""); }
  function porFid(f) { return document.querySelector('[data-fid="' + f + '"]'); }
  function caixa(el) { var r = el.getBoundingClientRect(), d = document.createElement("div");
    d.style.cssText = "position:absolute;left:" + (r.left + scrollX) + "px;top:" + (r.top + scrollY) + "px;width:" + r.width + "px;height:" + r.height +
      "px;border:2px solid #4f8ff7;border-radius:3px;background:#4f8ff718"; return d; }
  function desenha() {
    camada.innerHTML = "";
    var e = sel && porFid(sel); if (e) camada.appendChild(caixa(e));
    pins.forEach(function (p) { var el = porFid(p.fid); if (!el) return; var r = el.getBoundingClientRect(), b = document.createElement("div");
      b.textContent = p.n; b.style.cssText = "position:absolute;left:" + (Math.min(innerWidth - 24, r.right - 11) + scrollX) + "px;top:" + (Math.max(2, r.top - 11) + scrollY) +
        "px;width:22px;height:22px;border-radius:11px 11px 11px 2px;background:#f59e0b;color:#111;font:700 11px/18px system-ui;text-align:center;border:2px solid #fff";
      camada.appendChild(b); });
  }
  function escala() { // deck: cada slide 1920x1080 cabe na largura da tela
    var ss = document.querySelectorAll("body > [data-slide]"); if (!ss.length) return;
    var st = document.getElementById("forja-escala") || document.head.appendChild(Object.assign(document.createElement("style"), { id: "forja-escala" }));
    st.textContent = "body>[data-slide]{zoom:" + (innerWidth / 1920) + ";margin:0 0 12px!important;box-shadow:none!important}body{background:#3a3a3a!important}";
  }
  document.addEventListener("click", function (e) {
    if (!comentar) return;
    e.preventDefault(); e.stopPropagation();
    var el = alvo(e.target); sel = el ? el.getAttribute("data-fid") : null; desenha();
    window.ReactNativeWebView.postMessage(JSON.stringify({ tipo: "select", fid: sel, rotulo: el ? rotulo(el) : "" }));
  }, true);
  window.__forja = { modo: function (v) { comentar = v; if (!v) { sel = null; desenha(); } },
                     pins: function (p) { pins = p; desenha(); }, limpa: function () { sel = null; desenha(); } };
  addEventListener("resize", function () { escala(); desenha(); });
  function pronto() { document.documentElement.appendChild(camada); escala(); desenha();
    window.ReactNativeWebView.postMessage(JSON.stringify({ tipo: "pronto" })); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pronto); else pronto();
})();</script>`;

function paraCanvas(html: string) {
  const i = html.search(/<head[^>]*>/i);
  if (i < 0) return CSP + INSPETOR + html;
  const fim = html.indexOf(">", i) + 1;
  return html.slice(0, fim) + CSP + INSPETOR + html.slice(fim);
}

export default function Design({ conv, onCriada, onTurno }: { conv: Conv | null; onCriada: (c: Conv) => void; onTurno: () => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [p, setP] = useState<Projeto | null>(null);
  const [g, setG] = useState<Geracao | null>(null);
  const [aba, setAba] = useState<"design" | "chat" | "comentarios">("design");
  const [texto, setTexto] = useState("");
  const [comentar, setComentar] = useState(false);
  const [sel, setSel] = useState<{ fid: string; rotulo: string } | null>(null);
  const [modelo, setModelo] = useState<{ provider: string; model: string } | null>(null);
  const [perguntar, setPerguntar] = useState(true);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const web = useRef<WebView>(null);
  const abort = useRef<AbortController | null>(null);
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const { width } = useWindowDimensions();
  const rodando = g?.status === "rodando";

  const carrega = useCallback(async (id = convId) => {
    if (id == null) return setP(null);
    try { setP(await api.get<Projeto>(`/design/${id}`)); } catch (e: any) { setErro(e.message); }
  }, [convId]);

  const segue = useCallback(async (path: string, body?: unknown) => {
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    try {
      await streamSSE(path, (ev) => (ev.erro ? setErro(ev.erro) : setG(ev)), ac.signal, body);
    } catch (e: any) {
      if (!ac.signal.aborted) setErro(e.message);
    } finally {
      if (!ac.signal.aborted) { setG(null); carrega(); onTurno(); }
    }
  }, [carrega, onTurno]);

  // O mesmo modelo que o celular usa no chat (ou o último do PC): o backend usa ele em todas as etapas.
  useEffect(() => {
    Promise.all([lerAjustes<{ provider: string; model: string }>("modelo", { provider: "", model: "" }),
      lerAjustes<{ perguntar: boolean }>("design", { perguntar: true }),
      api.get<{ defaults: Record<string, string> }>("/mobile").catch(() => ({ defaults: {} as Record<string, string> }))])
      .then(([m, aj, { defaults: d }]) => { setModelo(m.model ? m : d.model ? { provider: d.provider, model: d.model } : null); setPerguntar(aj.perguntar); });
  }, []);
  useEffect(() => { carrega(); return () => abort.current?.abort(); }, [convId]);
  // Geração que o PC disparou (ou que já rodava ao abrir): acompanha pelo stream.
  useEffect(() => { if (p?.rodando && !rodando) segue(`/design/${p.rodando}/stream`); }, [p?.rodando]);

  // Ao vivo com o PC: o carimbo da lista no /activity muda quando o design muda em qualquer aparelho.
  const carimbo = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (convId == null || rodando) return;
    const olha = () => api.get<{ lista?: string }>("/activity").then((a) => {
      if (carimbo.current !== undefined && a.lista && a.lista !== carimbo.current) carrega();
      carimbo.current = a.lista;
    }).catch(() => {});
    olha();
    const t = setInterval(olha, 3000);
    return () => clearInterval(t);
  }, [convId, rodando, carrega]);

  const pendentes = (p?.comentarios ?? []).filter((x) => x.status === "pendente" && !x.orfao);
  const js = (codigo: string) => web.current?.injectJavaScript(`window.__forja && ${codigo}; true;`);
  useEffect(() => { js(`__forja.pins(${JSON.stringify(pendentes.map((x, i) => ({ fid: x.fids[0], n: i + 1 })))})`); }, [p?.comentarios]);
  useEffect(() => { js(`__forja.modo(${comentar})`); if (!comentar) setSel(null); }, [comentar]);

  async function projetoId() {
    if (convId != null) return convId;
    const nova = await api.post<Conv>("/conversations", { kind: "design" });
    onCriada(nova);
    setConvId(nova.id);
    return nova.id;
  }

  async function pedir(extra: { pedido?: string; respostas?: { pergunta: string; resposta: string }[] } = {}) {
    const pedido = (extra.pedido ?? texto).trim();
    if (!pedido || rodando) return;
    if (!modelo?.model) return toast("Escolha um modelo no chat primeiro.");
    setErro("");
    try {
      const id = await projetoId();
      if (extra.pedido === undefined) setTexto("");
      setAba("chat");
      setG({ message_id: 0, status: "rodando" });
      await segue(`/design/${id}/gerar`, { pedido, ...modelo, fids: sel && !comentar ? [sel.fid] : [], perguntar,
                                          respostas: extra.respostas ?? [] });
      setSel(null);
    } catch (e: any) { setErro(e.message); }
  }

  async function comentarAgora() {
    if (!sel || !texto.trim() || convId == null) return;
    try {
      setP(await api.post<Projeto>(`/design/${convId}/comentarios`, { fids: [sel.fid], texto: texto.trim() }));
      setTexto(""); setSel(null); js("__forja.limpa()");
      toast("Comentário salvo — aparece no PC na hora.");
    } catch (e: any) { setErro(e.message); }
  }

  async function ir(v: number) {
    if (!p || rodando || v < 1 || v > p.total) return;
    try { setP(await api.post<Projeto>(`/design/${p.conv_id}/ir`, { versao: v })); } catch (e: any) { setErro(e.message); }
  }

  const abaBtn = (id: typeof aba, rotulo: string) => (
    <Pressable key={id} onPress={() => setAba(id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: aba === id ? c.raised : "transparent" }}>
      <Text style={{ color: aba === id ? c.fg : c.muted, fontSize: 13.5 }}>{rotulo}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderBottomColor: c.line, borderBottomWidth: 1 }}>
        {abaBtn("design", "Design")}
        {abaBtn("chat", "Chat")}
        {abaBtn("comentarios", pendentes.length ? `Comentários ${pendentes.length}` : "Comentários")}
        <View style={{ flex: 1 }} />
        {!!p?.total && (
          <>
            <Pressable onPress={() => ir(p.atual - 1)} disabled={p.atual <= 1 || rodando} hitSlop={8} style={{ opacity: p.atual <= 1 ? 0.3 : 1 }}><Undo size={18} color={c.muted} /></Pressable>
            <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12 }}>v{p.atual}/{p.total}</Text>
            <Pressable onPress={() => ir(p.atual + 1)} disabled={p.atual >= p.total || rodando} hitSlop={8} style={{ opacity: p.atual >= p.total ? 0.3 : 1, transform: [{ scaleX: -1 }] }}><Undo size={18} color={c.muted} /></Pressable>
          </>
        )}
      </View>
      {!!erro && <Text style={{ color: c.err, paddingHorizontal: 14, paddingTop: 8, fontSize: 13 }} onPress={() => setErro("")}>{erro}</Text>}

      <View style={{ flex: 1 }}>
        {aba === "design" && (p?.html ? (
          <WebView ref={web} originWhitelist={["*"]} source={{ html: paraCanvas(p.html) }} style={{ flex: 1, backgroundColor: "#fff" }}
                   onMessage={(e) => {
                     const m = JSON.parse(e.nativeEvent.data || "{}");
                     if (m.tipo === "pronto") { js(`__forja.modo(${comentar})`); js(`__forja.pins(${JSON.stringify(pendentes.map((x, i) => ({ fid: x.fids[0], n: i + 1 })))})`); }
                     else if (m.tipo === "select") setSel(m.fid ? { fid: m.fid, rotulo: m.rotulo } : null);
                   }}
                   androidLayerType="hardware" key={`${p.conv_id}-${p.atual}-${width}`} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
            {rodando ? <ActivityIndicator color={c.muted} /> : (
              <Text style={[s.muted, { textAlign: "center" }]}>Descreva um site, uma apresentação ou um protótipo. Primeiro vem o plano; depois cada parte é escrita — acompanhe aqui ou no PC.</Text>
            )}
          </View>
        ))}

        {aba === "chat" && (
          <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
            {(p?.mensagens ?? []).map((m, i) => m.role === "user" ? (
              <View key={m.id} style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: c.raised, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 }}>
                <Text style={{ color: c.fg, fontSize: 14.5 }}>{m.content}</Text>
              </View>
            ) : m.status === "running" ? null : (
              <View key={m.id} style={{ gap: 6 }}>
                {!!m.passos?.length && <Text style={{ color: c.faint, fontSize: 12.5 }}>{m.passos.length} passos · {m.passos.slice(-1)[0]}</Text>}
                {!!m.mensagem && <Markdown texto={m.mensagem} />}
                {m.perguntas?.length ? (
                  <View style={{ gap: 10, borderColor: c.line, borderWidth: 1, borderRadius: 16, padding: 12 }}>
                    {m.perguntas.map((q) => (
                      <View key={q.pergunta} style={{ gap: 6 }}>
                        <Text style={{ color: c.fg, fontSize: 14 }}>{q.pergunta}</Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                          {q.opcoes.map((o) => <Chip key={o} rotulo={o} max={220} ativo={respostas[q.pergunta] === o} onPress={() => setRespostas((r) => ({ ...r, [q.pergunta]: o }))} />)}
                        </View>
                      </View>
                    ))}
                    <Botao primario rotulo="Responder e planejar" desabilitado={rodando}
                           onPress={() => pedir({ pedido: p!.mensagens[i - 1]?.content ?? "",
                             respostas: Object.entries(respostas).map(([pergunta, resposta]) => ({ pergunta, resposta })).concat(
                               Object.keys(respostas).length ? [] : [{ pergunta: "Perguntas", resposta: "(sem respostas: siga o pedido)" }]) })} />
                  </View>
                ) : m.plano ? (
                  <View style={{ gap: 8, borderColor: c.line, borderWidth: 1, borderRadius: 16, padding: 12 }}>
                    <Text style={{ color: c.fg, fontSize: 14 }}>{m.content}</Text>
                    <Text style={{ color: c.muted, fontSize: 13 }}>{m.plano.secoes.map((x) => x.nome).join(" · ")}</Text>
                    <Botao primario rotulo={`Gerar ${m.plano.secoes.length} ${m.plano.tipo === "slides" ? "slides" : m.plano.tipo === "prototipo" ? "telas" : "seções"}`}
                           desabilitado={rodando} onPress={() => { setG({ message_id: m.id, status: "rodando", modo: "etapas" });
                             segue(`/design/${m.id}/aprovar`, { plano: m.plano, ...modelo }); }} />
                    <Text style={[s.faint, { fontSize: 12 }]}>Para editar o plano (cores, ordem, conteúdo), abra no PC.</Text>
                  </View>
                ) : (
                  <Text style={{ color: m.status === "erro" ? c.err : m.versao ? c.accentText : c.faint, fontSize: 13 }}>{m.content}</Text>
                )}
                {!!m.sugestoes?.length && i === (p?.mensagens.length ?? 0) - 1 && !rodando && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {m.sugestoes.map((x) => <Chip key={x} rotulo={x} max={260} onPress={() => setTexto(x)} />)}
                  </View>
                )}
              </View>
            ))}
            {rodando && (
              <View style={{ gap: 4 }}>
                <Text style={{ color: c.muted, fontSize: 13 }}>{g?.modo === "etapas" ? "Escrevendo…" : "Gerando…"}</Text>
                {g?.secoes?.map((x) => <Text key={x.nome} style={{ color: x.status === "ok" ? c.muted : x.status === "gerando" ? c.accentText : c.faint, fontSize: 13 }}>
                  {x.status === "ok" ? "✓" : x.status === "gerando" ? "›" : "·"} {x.nome}</Text>)}
              </View>
            )}
          </ScrollView>
        )}

        {aba === "comentarios" && (
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
            {pendentes.length > 0 && <Botao primario rotulo={`Aplicar ${pendentes.length} pendente${pendentes.length > 1 ? "s" : ""} numa chamada`} desabilitado={rodando || !modelo}
                     onPress={async () => { const id = await projetoId(); setAba("chat"); setG({ message_id: 0, status: "rodando" });
                       segue(`/design/${id}/gerar`, { pedido: "", comentarios: pendentes.map((x) => x.id), ...modelo }); }} />}
            {!(p?.comentarios ?? []).length && <Text style={s.muted}>Em Design, ligue “Comentar”, toque num elemento e escreva. O comentário aparece no PC com o pin numerado.</Text>}
            {[...(p?.comentarios ?? [])].reverse().map((x) => {
              const n = pendentes.findIndex((y) => y.id === x.id) + 1;
              return (
                <View key={x.id} style={{ flexDirection: "row", gap: 8, borderColor: c.line, borderWidth: 1, borderRadius: 14, padding: 10, opacity: x.status === "pendente" ? 1 : 0.6 }}>
                  {n ? <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center" }}>
                         <Text style={{ color: "#111", fontSize: 11, fontWeight: "700" }}>{n}</Text></View>
                     : <Check size={16} color={c.ok} />}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: c.fg, fontSize: 14 }}>{x.texto}</Text>
                    <Text style={[s.faint, { fontSize: 12 }]}>{x.orfao ? "órfão: o elemento sumiu" : x.status}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          {sel && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: c.accentSoft, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: c.accentText, fontFamily: mono, fontSize: 12 }}>{sel.rotulo}</Text>
              <Pressable hitSlop={8} onPress={() => { setSel(null); js("__forja.limpa()"); }}><X size={12} color={c.accentText} /></Pressable>
            </View>
          )}
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 120, paddingHorizontal: 8, paddingTop: 6 }} value={texto} onChangeText={setTexto} multiline
                     placeholder={comentar ? (sel ? "Seu comentário sobre este elemento" : "Toque num elemento do design") : sel ? "O que mudar neste elemento?" : p?.total ? "O que mudar?" : "Ex.: landing page de uma padaria"}
                     placeholderTextColor={c.faint} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              {!!p?.html && <Chip rotulo="Comentar" ativo={comentar} icone={<Balao size={14} color={comentar ? c.accentText : c.muted} />}
                                  onPress={() => { setComentar(!comentar); setAba("design"); }} />}
              {!p?.total && <Chip rotulo="Perguntar antes" ativo={perguntar} icone={<Check size={14} color={perguntar ? c.accentText : c.muted} />}
                                  onPress={() => { setPerguntar(!perguntar); salvaAjustes("design", { perguntar: !perguntar }); }} />}
              {!!modelo && <Chip rotulo={modelo.model} max={170} onPress={() => toast("O Design usa o modelo escolhido no chat do celular.")} />}
            </ScrollView>
            {rodando ? (
              <Pressable onPress={() => g?.message_id && api.post(`/design/${g.message_id}/cancelar`).catch(() => {})}
                         style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: c.accentFg }} />
              </Pressable>
            ) : <BotaoEnviar pode={!!texto.trim() && (!comentar || !!sel)} onPress={() => (comentar ? comentarAgora() : pedir())} />}
          </View>
        </View>
      </View>
    </View>
  );
}
