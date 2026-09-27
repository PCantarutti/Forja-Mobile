import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "./api";
import { ArrowLeft, Check, Download, Film, Search } from "./icones";
import { useTeclado } from "./teclado";
import { Text, TextInput } from "./Texto";
import { c, mono, s } from "./tema";
import { Botao, Quadrado, toast } from "./ui";

// Baixar modelos pelo celular: os kits de vídeo prontos (KitsVideo do LocalPanel) e a busca no Hugging Face
// (ModelSearch do desktop). O download roda no PC; a fila embaixo lê os jobs do /local.
type Kit = { id: string; nome: string; resumo: string; modos: string[]; quant: string; erro?: string; gb_total: number; gb_falta: number;
             opcoes: { quant: string; gb: number; cabe: boolean | null; presente?: boolean }[] };
type Job = { id: string; kind: string; name: string; done: number; total: number; status: string; error: string };
type Hw = { gpus?: { name: string }[]; vram: number; ram: number };
type Modelo = { id: string; downloads: number; likes: number; tags: string[] };
type Arquivo = { path: string; size: number; quant: string };
const GB = 2 ** 30;
const gb = (b: number) => `${(b / GB).toFixed(1).replace(".", ",")} GB`;
const ORDENS = [["relevancia", "Relevância"], ["downloads", "Mais downloads"], ["curtidas", "Mais curtidas"], ["recentes", "Atualizados recentemente"]] as const;
const FOLGA = 1.2 * GB; // contexto e buffers de cálculo que sobem junto com os pesos (cabe() do desktop)

/** Se o arquivo cabe na VRAM, só com parte na RAM, ou não carrega. */
function cabe(bytes: number, hw?: Hw | null) {
  if (!bytes || !hw?.ram) return null;
  if (hw.vram && bytes + FOLGA <= hw.vram)
    return { rotulo: "cabe na GPU", cor: c.ok, fundo: c.okSoft, ok: true,
             dica: `Cabe inteiro na GPU: ${gb(bytes)} de ${gb(hw.vram)} de VRAM, com folga para o contexto. É o caso mais rápido.` };
  if (bytes + FOLGA <= hw.ram + hw.vram)
    return { rotulo: hw.vram ? "parte na RAM" : "só na CPU", cor: c.warn, fundo: c.warnSoft, ok: true,
             dica: hw.vram ? `Não cabe todo na VRAM (${gb(hw.vram)}): parte das camadas fica na RAM (${gb(hw.ram)}). Carrega, mas gera mais devagar.`
                           : `Sem GPU detectada: roda na CPU com ${gb(hw.ram)} de RAM. Devagar.` };
  return { rotulo: "não carrega", cor: c.err, fundo: c.errSoft, ok: false,
           dica: `Maior que a memória total da máquina (${gb(hw.vram)} de VRAM + ${gb(hw.ram)} de RAM). Não vai carregar.` };
}
const milhares = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
/** Chips do nome do repositório: tamanho (30B), MoE ativo (A3B) e código. */
function chips(id: string): string[] {
  const nome = id.split("/").pop() ?? id;
  const b = /(\d+(?:\.\d+)?)B(?![a-z])/i.exec(nome.replace(/A\d+(\.\d+)?B/i, ""))?.[1];
  const moe = /A(\d+(?:\.\d+)?)B/i.exec(nome)?.[1];
  return [b ? `${b}B` : "", moe ? `MoE A${moe}B` : "", /coder|code/i.test(nome) ? "código" : ""].filter(Boolean);
}

// Aberta de qualquer lugar (IA local, folha do modelo de vídeo): montada uma vez na raiz, como o Dialogo.
let abre: (() => void) | null = null;
export const abreBaixarModelos = () => abre?.();
export function BaixarModelosRaiz() {
  const [aberta, setAberta] = useState(false);
  useEffect(() => { abre = () => setAberta(true); return () => { abre = null; }; }, []);
  return <BaixarModelos aberta={aberta} onFecha={() => setAberta(false)} />;
}

export default function BaixarModelos({ aberta, onFecha }: { aberta: boolean; onFecha: () => void }) {
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const [aba, setAba] = useState<"kits" | "hf">("kits");
  const [st, setSt] = useState<{ hardware: Hw; jobs: Job[]; download_dir: string; gpu_video?: { gb?: number } } | null>(null);
  const [erro, setErro] = useState("");
  const carregaLocal = () => api.get<NonNullable<typeof st>>("/local").then(setSt).catch((e) => setErro(e.message));
  const rodando = !!st?.jobs.some((j) => j.status === "running");
  useEffect(() => { if (aberta) carregaLocal(); }, [aberta]);
  // A fila só é relida a cada 3 s enquanto algum download roda no PC.
  useEffect(() => {
    if (!aberta || !rodando) return;
    const t = setInterval(carregaLocal, 3000);
    return () => clearInterval(t);
  }, [aberta, rodando]);
  const hw = st?.hardware;
  const fila = (st?.jobs ?? []).filter((j) => j.kind === "modelo");
  return (
    <Modal visible={aberta} animationType="slide" onRequestClose={onFecha} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: inset.top, paddingBottom: teclado }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, height: 60 }}>
          <Pressable hitSlop={8} onPress={onFecha} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={21} color={c.fg} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 16, fontWeight: "600" }}>Baixar modelos</Text>
            {!!hw && (
              <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>
                {[hw.gpus?.[0]?.name, hw.vram ? `${Math.round(hw.vram / GB)} GB VRAM` : "sem GPU", `${Math.round(hw.ram / GB)} GB RAM`].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
          {([["kits", "Kits prontos", Film], ["hf", "Hugging Face", Search]] as const).map(([id, rot, Icone]) => (
            <Pressable key={id} onPress={() => setAba(id)}
                       style={{ flex: 1, height: 40, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
                                borderColor: aba === id ? c.accentLine : c.line, backgroundColor: aba === id ? c.accentSoft : "transparent" }}>
              <Icone size={14} color={aba === id ? c.accentText : c.muted} />
              <Text style={{ color: aba === id ? c.fg : c.muted, fontSize: 13.5, fontWeight: aba === id ? "600" : "400" }}>{rot}</Text>
            </Pressable>
          ))}
        </View>
        {!!erro && <Text style={{ color: c.err, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 }} onPress={() => setErro("")}>{erro}</Text>}
        <View style={{ flex: 1 }}>
          {aba === "kits" ? <Kits destino={st?.download_dir ?? ""} baixando={fila.filter((j) => j.status === "running")} onBaixou={carregaLocal} onErro={setErro} />
            : <Hf hw={hw} destino={st?.download_dir ?? ""} onBaixou={carregaLocal} onErro={setErro} />}
        </View>
        {fila.length > 0 && (
          <View style={{ borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.side, padding: 12, paddingBottom: inset.bottom + 12, gap: 8 }}>
            <Text style={s.secao2}>BAIXANDO NO PC</Text>
            {fila.slice(-3).map((j) => {
              const pronto = j.status === "pronto";
              return (
                <View key={j.id} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Text style={{ color: c.fg2, fontFamily: mono, fontSize: 12, flex: 1 }} numberOfLines={1}>{j.name}</Text>
                    <Text style={{ color: j.status === "erro" ? c.err : c.faint, fontFamily: mono, fontSize: 11.5 }}>
                      {j.status === "erro" ? "erro" : j.total ? `${(j.done / GB).toFixed(1).replace(".", ",")} / ${gb(j.total)}` : j.status}
                    </Text>
                  </View>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" }}>
                    <View style={{ height: 4, width: `${pronto ? 100 : j.total ? (j.done / j.total) * 100 : 0}%`, backgroundColor: pronto ? c.ok : c.accent }} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </Modal>
  );
}

function Kits({ destino, baixando, onBaixou, onErro }: { destino: string; baixando: Job[]; onBaixou: () => void; onErro: (e: string) => void }) {
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [quants, setQuants] = useState<Record<string, string>>({});
  const carregar = () => api.get<{ kits: Kit[] }>(`/local/video/kits?quants=${encodeURIComponent(JSON.stringify(quants))}`, 60000)
    .then((r) => setKits(r.kits)).catch((e) => { setKits([]); onErro(e.message); });
  useEffect(() => { carregar(); }, [quants, baixando.length]);
  if (!kits) return <ActivityIndicator style={{ marginTop: 30 }} color={c.muted} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12 }}>
      <Text style={[s.muted, { lineHeight: 19 }]}>Um toque baixa o modelo, o VAE e o codificador de texto. A quantização já vem na maior que cabe na sua GPU.</Text>
      {kits.map((k) => {
        const op = k.opcoes.find((o) => o.quant === k.quant);
        const noDisco = k.gb_falta === 0;
        const job = baixando.find((j) => k.nome && j.name.toLowerCase().includes((k.quant || k.nome).toLowerCase()));
        return (
          <View key={k.id} style={{ backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 12, gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Quadrado><Film size={17} color={c.fg} /></Quadrado>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>{k.nome}</Text>
                <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }}>{k.resumo}</Text>
              </View>
            </View>
            {!!k.erro && <Text style={{ color: c.warn, fontSize: 12.5 }}>{k.erro}</Text>}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {k.opcoes.map((o) => {
                const on = o.quant === k.quant;
                return (
                  <Pressable key={o.quant} onPress={() => setQuants((q) => ({ ...q, [k.id]: o.quant }))}
                             style={{ borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, borderColor: on ? c.accentLine : c.line,
                                      backgroundColor: on ? c.accentSoft : "transparent" }}>
                    <Text style={{ color: on ? c.fg : c.fg2, fontFamily: mono, fontSize: 12.5, fontWeight: "600" }} numberOfLines={1}>{o.quant}</Text>
                    <Text style={{ color: c.faint, fontSize: 11 }} numberOfLines={1}>
                      {o.gb.toFixed(1).replace(".", ",")} GB
                      {o.presente ? <Text style={{ color: c.ok }}> · no disco</Text> : o.cabe === false ? <Text style={{ color: c.warn }}> · não cabe</Text> : null}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {job ? (
              <View style={{ gap: 4 }}>
                <Text style={{ color: c.muted, fontSize: 12.5 }}>Baixando no PC…</Text>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" }}>
                  <View style={{ height: 4, width: `${job.total ? (job.done / job.total) * 100 : 0}%`, backgroundColor: c.accent }} />
                </View>
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{(job.done / GB).toFixed(1).replace(".", ",")} de {gb(job.total)}</Text>
              </View>
            ) : noDisco ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 44, justifyContent: "center" }}>
                <Check size={16} color={c.ok} /><Text style={{ color: c.ok, fontSize: 14 }}>No disco</Text>
              </View>
            ) : (
              <Botao primario altura={44} icone={<Download size={15} color={c.accentFg} />} desabilitado={!!k.erro}
                     rotulo={`Baixar ${k.quant} · ${(op?.gb ?? k.gb_falta).toFixed(1).replace(".", ",")} GB`}
                     onPress={() => api.post("/local/video/kit", { id: k.id, folder: destino, quant: k.quant })
                       .then(() => { toast(`${k.nome} baixando no PC.`); onBaixou(); carregar(); }).catch((e) => onErro(e.message))} />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Hf({ hw, destino, onBaixou, onErro }: { hw?: Hw; destino: string; onBaixou: () => void; onErro: (e: string) => void }) {
  const [q, setQ] = useState("");
  const [ordem, setOrdem] = useState("relevancia");
  const [lista, setLista] = useState<Modelo[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [arquivos, setArquivos] = useState<Arquivo[] | null>(null);
  const [baixados, setBaixados] = useState<string[]>([]);
  const pedido = useRef(0);
  // Busca sozinha quando a digitação para (450 ms), como o ModelSearch.
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      const meu = ++pedido.current;
      setBuscando(true);
      api.get<{ models: Modelo[] }>(`/local/search?kind=text&sort=${ordem}&q=${encodeURIComponent(q.trim())}`, 30000)
        .then((r) => meu === pedido.current && setLista(r.models)).catch((e) => onErro(e.message))
        .finally(() => meu === pedido.current && setBuscando(false));
    }, 450);
    return () => clearTimeout(t);
  }, [q, ordem]);
  useEffect(() => {
    if (!sel) return;
    setArquivos(null);
    api.get<{ files: Arquivo[] }>(`/local/repo?kind=text&repo=${encodeURIComponent(sel)}`, 30000)
      .then((r) => setArquivos(r.files)).catch((e) => onErro(e.message));
  }, [sel]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }} keyboardShouldPersistTaps="handled">
      <View style={{ height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, flexDirection: "row", alignItems: "center",
                     gap: 8, paddingHorizontal: 12 }}>
        <Search size={15} color={c.faint} />
        <TextInput style={{ flex: 1, color: c.fg, fontSize: 14, padding: 0 }} value={q} onChangeText={setQ} autoCapitalize="none"
                   placeholder="Buscar no Hugging Face (ex.: qwen coder gguf)" placeholderTextColor={c.faint} />
        {buscando && <ActivityIndicator size="small" color={c.muted} />}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {ORDENS.map(([id, rot]) => (
          <Pressable key={id} onPress={() => setOrdem(id)} style={{ height: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: "center",
                                                                   backgroundColor: ordem === id ? c.accent : c.raised }}>
            <Text style={{ color: ordem === id ? c.accentFg : c.muted, fontSize: 13 }} numberOfLines={1}>{rot}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {sel ? (
        <View style={{ gap: 10 }}>
          <Pressable onPress={() => setSel(null)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ArrowLeft size={15} color={c.muted} /><Text style={{ color: c.fg, fontFamily: mono, fontSize: 13, flex: 1 }}>{sel}</Text>
          </Pressable>
          <Text style={s.secao2}>ARQUIVOS GGUF</Text>
          {!arquivos ? <ActivityIndicator color={c.muted} /> : !arquivos.length ? <Text style={s.faint}>Nenhum .gguf neste repositório.</Text> : arquivos.map((f) => {
            const k = cabe(f.size, hw);
            const ja = baixados.includes(f.path);
            return (
              <View key={f.path} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12, gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13, fontWeight: "600" }}>{f.quant || f.path.split("/").pop()}</Text>
                  <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{gb(f.size)}</Text>
                  <View style={{ flex: 1 }} />
                  {k && <Text style={{ color: k.cor, backgroundColor: k.fundo, fontSize: 11, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" }}>{k.rotulo}</Text>}
                </View>
                {k && <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{k.dica}</Text>}
                <Botao altura={36} rotulo={ja ? "Baixando no PC" : "Baixar"} icone={ja ? <Check size={14} color={c.ok} /> : <Download size={14} color={c.fg} />}
                       desabilitado={ja || k?.ok === false}
                       onPress={() => api.post("/local/download", { repo: sel, file: f.path, folder: destino })
                         .then(() => { setBaixados((b) => [...b, f.path]); onBaixou(); }).catch((e) => onErro(e.message))} />
              </View>
            );
          })}
        </View>
      ) : (lista ?? []).map((m) => (
        <Pressable key={m.id} onPress={() => { Keyboard.dismiss(); setSel(m.id); }} style={({ pressed }) => ({ backgroundColor: pressed ? c.raised : c.surface, borderRadius: 12, padding: 12, gap: 6 })}>
          <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13 }}>{m.id.split("").join("​")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {chips(m.id).map((x) => (
                <Text key={x} style={{ color: c.muted, fontFamily: mono, fontSize: 11, backgroundColor: c.raised, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" }}>{x}</Text>
              ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <Download size={12} color={c.faint} /><Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{milhares(m.downloads)}</Text>
            </View>
          </View>
        </Pressable>
      ))}
      {lista && !lista.length && !sel && <Text style={s.faint}>Nada encontrado.</Text>}
    </ScrollView>
  );
}
