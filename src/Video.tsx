import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { api, base, enviaArquivo, lerAjustes, type Msg, salvaAjustes, urlImagem } from "./api";
import type { Conv } from "./Chat";
import { pergunta } from "./Dialogo";
import { Cubo, Enviar, Parar, Voltar } from "./icones";
import { type Destino, salva } from "./Imagens";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Campo, Chip, Contador, Folha, Lista, Opcao, Seletor } from "./ui";

// Vídeo (Wan pelo stable-diffusion.cpp) = o motor dos lotes de imagem com conversa kind "video": mesmas rotas
// /imagens/*, arquivos .webm. Espelha o VideoView do desktop no que cabe no celular.
type Req = { nome?: string; modos?: string[]; multiplo?: number; resolucoes?: Record<string, [number, number]>; quadros_treino?: number };
type ModeloVid = { path: string; name: string; params?: Record<string, any>; req?: Req; falta?: string[]; chave?: string; dim?: number };
type Lora = { path: string; name: string; wan?: boolean; dim?: number; passos?: number };
type Tempo = { model: string; w: number; h: number; frames: number; passos: number; s_passo: number; s_total: number };
type Opts = Record<string, any> & { steps: number; cfg: number; width: number; height: number; frames: number; fps: number;
                                    negative?: string; flow_shift?: number; high_noise_steps?: number; high_noise_cfg?: number;
                                    loras?: { path: string; peso: number }[] };
type LocalVid = { video: Opts; video_models: ModeloVid[]; loras: Lora[]; tempos_video: Tempo[]; image_busy?: boolean; runtimes: any };
type Img = { path: string; seed: number; model_name?: string; status: string; progress?: number; preview?: string; com_previa?: boolean;
             restante?: number; s_passo?: number; error?: string };
type Tomada = { user?: Msg; msg: Msg; imgs: Img[] };
type Ajustes = { modelo: string; modo: string; count: number; seed: number; seed_mode: string; o: Opts | null };

const MODOS = [
  { id: "t2v", rotulo: "Texto", refs: 0, dica: "Só o prompt: o modelo inventa a cena inteira.",
    exemplo: "a red fox trotting through fresh snow at dawn, slow tracking shot, soft golden light" },
  { id: "i2v", rotulo: "Imagem", refs: 1, dica: "Anima uma imagem: ela é o primeiro quadro.",
    exemplo: "the camera slowly pushes in while the hair and the clouds move gently in the wind" },
  { id: "flf2v", rotulo: "Início→Fim", refs: 2, dica: "Liga dois quadros: o modelo inventa o caminho.",
    exemplo: "a smooth continuous transition, the flower slowly blossoms, static camera" },
];
const pronto = (i: Img) => ["pronta", "mantida"].includes(i.status);
const pilha = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0, borderRadius: 14, borderWidth: 1, borderColor: c.line };
const SEMENTES = [{ id: "incremental", rotulo: "Incremental" }, { id: "aleatoria", rotulo: "Aleatória" }, { id: "fixa", rotulo: "Fixa" }];
const PROPORCOES = ["16:9", "9:16", "1:1"] as const;
const REFAZIVEIS = ["interrompida", "pendente", "cancelada", "erro"];
const ROTULO: Record<string, string> = { pendente: "na fila", gerando: "gerando", erro: "erro", cancelada: "cancelada",
  interrompida: "interrompida", descartada: "descartada", mantida: "mantida", pronta: "" };
// Arquivos e ligações de memória são do modelo (IA local › Modelos): o padrão da aba não passa por cima (VideoView).
const DO_MODELO = ["model", "seed", "offload", "flash_attn", "vae_tiling", "te_cpu", "preview", "taesd", "vae", "clip_l", "t5xxl", "llm",
  "llm_vision", "clip_vision", "high_noise_model", "variante", "diffusion_model", "out_dir", "descarte_dias"];

// videoConta.ts do desktop: quadros 4k+1 (o VAE do Wan junta 4 em 1), tamanhos e durações a partir da variante.
const quadrosDe = (seg: number, fps: number) => Math.max(1, Math.round((seg * fps) / 4)) * 4 + 1;
function tamanhosDe(req?: Req) {
  const mult = req?.multiplo ?? 16;
  const encaixa = (v: number) => Math.max(mult, Math.round(v / mult) * mult);
  return Object.entries(req?.resolucoes ?? { "480p": [832, 480] as [number, number] }).flatMap(([q, [w, h]]) => {
    const lado = encaixa(Math.sqrt(w * h));
    const por: Record<string, [number, number]> = { "16:9": [encaixa(w), encaixa(h)], "9:16": [encaixa(h), encaixa(w)], "1:1": [lado, lado] };
    return PROPORCOES.map((p) => ({ id: `${p} ${q}`, w: por[p][0], h: por[p][1] }));
  });
}
function duracoesDe(req: Req | undefined, fps: number) {
  const max = Math.round(((req?.quadros_treino ?? 81) / (fps || 16)) * 2) / 2;
  return [...new Set([1, Math.max(1, Math.round(max)) / 2, max])].filter((d) => d >= 1).sort((a, b) => a - b);
}
/** Estimativa pelo que a máquina já mediu com o mesmo modelo (expoente tirado das medições; linear com uma só). */
function estimar(tempos: Tempo[], chave: string | undefined, o: Opts): { s: number; minimo: boolean } | null {
  const doModelo = tempos.filter((t) => t.model === chave && t.s_passo > 0);
  if (!doModelo.length) return null;
  const tok = (t: { w: number; h: number; frames: number }) => t.w * t.h * t.frames;
  const alvo = tok({ w: o.width, h: o.height, frames: o.frames });
  const ref = doModelo.reduce((a, b) => (Math.abs(Math.log(tok(b) / alvo)) < Math.abs(Math.log(tok(a) / alvo)) ? b : a));
  const pares = doModelo.flatMap((a, i) => doModelo.slice(i + 1).filter((b) => tok(a) !== tok(b)).map((b) => [a, b]));
  const k = pares.length ? pares.reduce((t, [a, b]) => t + Math.log(a.s_passo / b.s_passo) / Math.log(tok(a) / tok(b)), 0) / pares.length : 1;
  const carga = Math.max(0, ref.s_total - ref.passos * ref.s_passo);
  return { s: carga + (o.steps + Math.max(0, o.high_noise_steps ?? 0)) * ref.s_passo * (alvo / tok(ref)) ** k,
           minimo: tok(ref) !== alvo && !pares.length };
}
const tempo = (sg: number) => (sg < 90 ? `${Math.round(sg)} s` : `${Math.round(sg / 60)} min`);
const mesmo = (a: string, b: string) => a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();

/** WebM no <video> do WebView: o Android toca, e não precisa de player nativo novo. `quadro` = só o 1º quadro, mudo. */
const htmlVideo = (src: string, quadro: boolean) =>
  `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#111;height:100%;overflow:hidden}` +
  `video{width:100%;height:100%;object-fit:${quadro ? "cover" : "contain"}}</style></head><body>` +
  `<video src="${quadro ? `${src}#t=0.1` : src}" ${quadro ? 'muted playsinline preload="metadata"' : "controls autoplay loop playsinline"}></video></body></html>`;

function VideoWeb({ path, quadro }: { path: string; quadro?: boolean }) {
  return (
    <WebView source={{ html: htmlVideo(urlImagem(path), !!quadro), baseUrl: base() }} originWhitelist={["*"]} style={{ flex: 1, backgroundColor: "#111" }}
             mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback scrollEnabled={false} pointerEvents={quadro ? "none" : "auto"}
             androidLayerType="hardware" />
  );
}

export default function Video({ conv, onCriada, onTurno }: { conv: Conv | null; onCriada: (c: Conv) => void; onTurno: () => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [st, setSt] = useState<LocalVid | null>(null);
  const [aj, setAj] = useState<Ajustes | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [erro, setErro] = useState("");
  const [folha, setFolha] = useState<null | "ajustes" | "modelo">(null);
  const [melhorando, setMelhorando] = useState(false);
  const [acel, setAcel] = useState<{ arquivos: { gb: number; presente: string }[]; motivo?: string } | null>(null);
  const [foco, setFoco] = useState<number | null>(null);
  const antesDoAcel = useRef<Partial<Opts> | null>(null);
  const lista = useRef<FlatList>(null);
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();

  // Pelo ref: quem chama depois de criar a conversa (gerar, repetir com confirm) é um closure com o convId antigo.
  const convRef = useRef(convId);
  convRef.current = convId;
  const carrega = useCallback(async () => {
    const convId = convRef.current;
    if (convId == null) return;
    try { setMsgs((await api.get<{ messages: Msg[] }>(`/conversations/${convId}`)).messages); }
    catch (e: any) { setErro(e.message); }
  }, [convId]);

  const carregaLocal = useCallback(() => api.get<LocalVid>("/local").then((l) => {
    setSt(l);
    // Modelo que apareceu depois (kit baixado, pasta nova): vira o escolhido se não havia nenhum.
    setAj((a) => (a && !l.video_models.some((m) => m.path === a.modelo) && l.video_models[0] ? { ...a, modelo: l.video_models[0].path } : a));
  }).catch((e) => setErro(e.message)), []);
  // Como o VideoView: sem modelo, com a GPU ocupada ou com download rodando, o estado do PC é relido a cada 4 s.
  useEffect(() => {
    if (!st || (st.video_models.length && !st.image_busy && !(st as any).jobs?.some((j: any) => j.status === "running"))) return;
    const t = setInterval(carregaLocal, 4000);
    return () => clearInterval(t);
  }, [st, carregaLocal]);

  useEffect(() => {
    carrega();
    api.get<LocalVid>("/local").then(async (l) => {
      setSt(l);
      const padrao: Ajustes = { modelo: l.video?.model || l.video_models[0]?.path || "", modo: "t2v", count: 1, seed: 0, seed_mode: "incremental", o: l.video };
      const salvo = await lerAjustes<Ajustes>("video", padrao);
      if (!l.video_models.some((m) => m.path === salvo.modelo)) salvo.modelo = padrao.modelo;
      setAj({ ...salvo, o: salvo.o ?? l.video });
    }).catch((e) => setErro(e.message));
  }, [carrega]);

  const muda = (x: Partial<Ajustes>) => setAj((a) => { const n = { ...(a as Ajustes), ...x }; salvaAjustes("video", n); return n; });
  const mudaO = (x: Partial<Opts>) => aj?.o && muda({ o: { ...aj.o, ...x } });
  const modelo = st?.video_models.find((m) => m.path === aj?.modelo);
  const modos = modelo?.req?.modos ?? ["t2v"];

  // Acelerador (LoRA de poucos passos) do modelo escolhido: presente, ou quanto baixa.
  useEffect(() => {
    setAcel(null);
    if (!aj?.modelo) return;
    api.get<typeof acel>(`/local/video/aceleradores?model=${encodeURIComponent(aj.modelo)}`, 20000).then(setAcel).catch(() => {});
  }, [aj?.modelo]);
  const acelArquivos = (acel?.arquivos ?? []).map((a) => a.presente).filter(Boolean);
  const acelPronto = !!acel?.arquivos.length && acelArquivos.length === acel.arquivos.length;
  const acelerando = acelPronto && acelArquivos.every((p) => aj?.o?.loras?.some((l) => mesmo(l.path, p)));

  /** Os ajustes sugeridos do modelo (ou os salvos nele) viram os da tela, e o modo cai no que ele faz. */
  function escolheModelo(m: ModeloVid) {
    const p = m.params ?? {};
    const chaves = ["steps", "cfg", "sampler", "width", "height", "frames", "fps", "flow_shift", "high_noise_steps", "high_noise_cfg"];
    const o = { ...(aj?.o as Opts), ...Object.fromEntries(chaves.filter((k) => p[k] != null).map((k) => [k, p[k]])), loras: p.loras ?? [] };
    const ms = m.req?.modos ?? ["t2v"];
    antesDoAcel.current = null;
    muda({ modelo: m.path, o, modo: ms.includes(aj?.modo ?? "") ? aj!.modo : ms[0] });
    setFolha(null);
  }

  function alternaAcel() {
    const o = aj?.o;
    if (!o || !st) return;
    if (!acelPronto) {
      const gb = (acel?.arquivos ?? []).reduce((t, a) => t + (a.presente ? 0 : a.gb), 0);
      if (!acel?.arquivos.length) return setErro(acel?.motivo || "Não há acelerador para este modelo.");
      return pergunta("Baixar acelerador", `LoRA de poucos passos para este modelo (${gb.toFixed(1)} GB). Baixa no PC e depois o ⚡ liga com um toque.`, [
        { texto: "Cancelar", estilo: "cancelar" },
        { texto: "Baixar", acao: () => api.post("/local/video/acelerador", { model: aj!.modelo }).then(carregaLocal).catch((e) => setErro(e.message)) },
      ]);
    }
    const fora = (o.loras ?? []).filter((l) => !acelArquivos.some((p) => mesmo(p, l.path)));
    if (acelerando) { mudaO({ ...(antesDoAcel.current ?? {}), loras: fora }); antesDoAcel.current = null; return; }
    const passos = Math.max(0, ...st.loras.filter((l) => acelArquivos.some((p) => mesmo(p, l.path))).map((l) => l.passos ?? 0)) || o.steps;
    antesDoAcel.current = { steps: o.steps, cfg: o.cfg, high_noise_steps: o.high_noise_steps, high_noise_cfg: o.high_noise_cfg };
    // -1: o sd.cpp divide os passos entre os dois modelos (A14B)
    mudaO({ steps: passos, cfg: 1, high_noise_cfg: 1, high_noise_steps: -1, loras: [...fora, ...acelArquivos.map((path) => ({ path, peso: 1 }))] });
  }

  const tomadas = useMemo<Tomada[]>(() => {
    const out: Tomada[] = [];
    msgs.forEach((m, i) => { if (m.meta?.images) out.push({ user: msgs[i - 1]?.role === "user" ? msgs[i - 1] : undefined, msg: m, imgs: m.meta.images }); });
    return out;
  }, [msgs]);
  const rodando = tomadas.some((t) => t.msg.status === "running");
  // Vídeos prontos, do mais novo ao mais velho: o player passa por eles (Manter/Descartar já vão ao próximo).
  const fila = useMemo(() => [...tomadas].reverse().flatMap((t) => t.imgs.filter(pronto).map((img) => ({ img, mid: t.msg.id, t }))), [tomadas]);
  const rodava = useRef(false);
  useEffect(() => { if (rodava.current && !rodando) { onTurno(); carregaLocal(); } rodava.current = rodando; }, [rodando]);
  useEffect(() => { // sem SSE: a conversa é consultada a cada 1,5 s enquanto gera (como o desktop)
    if (!rodando) return;
    const t = setInterval(carrega, 1500);
    return () => clearInterval(t);
  }, [rodando, carrega]);

  /** 409 = modelo de texto na VRAM (ou outro programa na GPU): pergunta e repete com confirm. */
  async function comVram(faz: (confirm: boolean) => Promise<unknown>, oQue: string) {
    try { await faz(false); } catch (e: any) {
      if (e.status === 409)
        return pergunta("GPU ocupada", `${e.message}\n\nDescarregar e ${oQue}?`,
          [{ texto: "Cancelar", estilo: "cancelar" }, { texto: `Descarregar e ${oQue}`, acao: () => faz(true).then(carrega).catch((er) => setErro(er.message)) }]);
      setErro(e.message);
    }
  }

  const precisa = MODOS.find((m) => m.id === aj?.modo)?.refs ?? 0;
  async function gera() {
    const texto = prompt.trim();
    if (!texto || !aj?.o || !aj.modelo) return;
    if (refs.length < precisa) return setErro(precisa === 1 ? "Escolha a imagem que vai ser animada." : "Escolha o quadro inicial e o final.");
    setErro("");
    const opts = Object.fromEntries(Object.entries(aj.o).filter(([k, v]) => !DO_MODELO.includes(k) && v !== null && v !== ""));
    let id = convId; // antes do comVram: o repetir com confirm não pode abrir outra conversa
    if (id == null) {
      try { const nova = await api.post<Conv>("/conversations", { kind: "video" }); id = nova.id; convRef.current = id; onCriada(nova); setConvId(id); }
      catch (e: any) { return setErro(e.message); }
    }
    await comVram(async (confirm) => {
      await api.put("/local/video/defaults", { ...aj.o, model: aj.modelo }); // vira o padrão do video_generate do agente
      await api.post(`/imagens/${id}/gerar`, { prompt: texto, opts, models: [aj.modelo], count: aj.count, seed: aj.seed,
        seed_mode: aj.seed_mode, confirm, refs: refs.slice(0, precisa) });
      setPrompt("");
      carrega();
    }, "gerar");
  }

  async function melhora() {
    const texto = prompt.trim();
    if (!texto) return;
    setMelhorando(true);
    try {
      const m = await lerAjustes<{ provider: string; model: string }>("modelo", { provider: "", model: "" });
      const d = m.model ? m : (await api.get<{ defaults: { provider: string; model: string } }>("/mobile")).defaults;
      if (!d.model) throw new Error("Escolha um modelo de texto no Chat antes.");
      setPrompt((await api.post<{ prompt: string }>("/imagens/prompt", { prompt: texto, provider: d.provider, model: d.model, video: true }, 180000)).prompt);
    } catch (e: any) { setErro(e.message); }
    setMelhorando(false);
  }

  async function quadro(i: number) {
    const r = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true }).catch(() => null);
    if (!r || r.canceled) return;
    try {
      const a = r.assets[0];
      const { path } = await enviaArquivo<{ path: string }>("/imagens/referencia", { uri: a.uri, name: a.name, mimeType: a.mimeType });
      setRefs((x) => { const n = [...x]; n[i] = path; return n.filter(Boolean); });
    } catch (e: any) { setErro(e.message); }
  }

  const reaproveita = (t: Tomada) => {
    const m = t.user?.meta ?? {};
    setPrompt(t.user?.content ?? "");
    setRefs(m.refs ?? []);
    if (aj) muda({ modelo: m.models?.[0] ?? aj.modelo, count: m.count ?? aj.count, seed_mode: m.seed_mode ?? aj.seed_mode, seed: m.seed ?? aj.seed,
      modo: ["t2v", "i2v", "flf2v"][Math.min(2, (m.refs ?? []).length)], o: { ...(aj.o as Opts), ...(m.opts ?? {}) } });
  };

  const acao = (path: string, body?: unknown) => api.post(path, body).then(carrega).catch((e) => setErro(e.message));
  const o = aj?.o;
  const est = o && st ? estimar(st.tempos_video ?? [], modelo?.chave, o) : null;
  const seg = o ? Math.round(((o.frames - 1) / (o.fps || 16)) * 10) / 10 : 0;
  const semRuntime = st && !st.runtimes?.sd?.installed;
  const pode = !!prompt.trim() && !!aj?.modelo && !rodando && !st?.image_busy && !semRuntime && refs.length >= precisa;

  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      <FlatList
        ref={lista}
        data={tomadas}
        keyExtractor={(t) => String(t.msg.id)}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: 12, gap: 18, flexGrow: tomadas.length ? 0 : 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: "center", gap: 14, padding: 12 }}>
            <View style={{ alignItems: "center", gap: 6 }}>
              <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600" }}>Que cena vamos filmar?</Text>
              <Text style={[s.muted, { textAlign: "center" }]}>
                {semRuntime ? "Instale o stable-diffusion.cpp em IA local no desktop." :
                 st && !st.video_models.length ? "Nenhum modelo de vídeo no PC. Baixe um kit Wan em IA local › Vídeo, no desktop." :
                 modelo && o ? `${modelo.req?.nome ?? modelo.name} · ${o.width}×${o.height} · ${seg} s${est ? ` · ${est.minimo ? "≥" : "~"}${tempo(est.s)} cada` : ""}` :
                 "Descreva a cena, o movimento e a câmera."}
              </Text>
            </View>
            {!semRuntime && !!st?.video_models.length && MODOS.filter((m) => modos.includes(m.id)).map((m) => (
              <Pressable key={m.id} onPress={() => { muda({ modo: m.id }); setPrompt(m.exemplo); }}
                         style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 }}>
                <Text style={[s.txt, { fontWeight: "600" }]}>{m.rotulo}</Text>
                <Text style={[s.faint, { fontSize: 12.5 }]}>{m.dica}</Text>
                <Text style={[s.muted, { fontSize: 13, fontStyle: "italic" }]} numberOfLines={2}>“{m.exemplo}”</Text>
              </Pressable>
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <TomadaView t={item} onFoco={(img) => setFoco(Math.max(0, fila.findIndex((f) => f.img.path === img.path)))} onAcao={acao} onReaproveita={() => reaproveita(item)}
                      onContinua={() => comVram((confirm) => api.post(`/imagens/${item.msg.id}/continuar`, { confirm }).then(carrega), "continuar")} />
        )}
      />
      {!!erro && <Text style={[s.muted, { color: c.red, paddingHorizontal: 14 }]} onPress={() => setErro("")}>{erro}</Text>}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        {modos.length > 1 && (
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
            {MODOS.filter((m) => modos.includes(m.id)).map((m) => {
              const on = aj?.modo === m.id;
              return (
                <Pressable key={m.id} onPress={() => muda({ modo: m.id })}
                           style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, borderWidth: 1,
                                    borderColor: on ? c.fg : c.line, backgroundColor: on ? c.raised : "transparent" }}>
                  <Text style={{ color: on ? c.fg : c.muted, fontSize: 13, fontWeight: on ? "600" : "400" }}>{m.rotulo}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          {precisa > 0 && (
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4 }}>
              {Array.from({ length: precisa }, (_, i) => (
                <Pressable key={i} onPress={() => (refs[i] ? setRefs((x) => x.filter((_, j) => j !== i)) : quadro(i))}
                           style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: c.raised, borderColor: c.line, borderWidth: 1,
                                    alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {refs[i] ? <Image source={{ uri: urlImagem(refs[i]) }} style={{ width: "100%", height: "100%" }} /> :
                    <Text style={[s.faint, { fontSize: 11, textAlign: "center" }]}>{precisa === 1 ? "imagem" : i ? "fim" : "início"}{"\n"}+</Text>}
                </Pressable>
              ))}
              {precisa === 2 && refs.length === 2 && (
                <Pressable onPress={() => setRefs(([a, b]) => [b, a])} style={[s.btnSec, { alignSelf: "center" }]}><Text style={s.btnSecTxt}>⇄</Text></Pressable>
              )}
            </View>
          )}
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={prompt}
                     onChangeText={setPrompt} multiline placeholderTextColor={c.faint}
                     placeholder={precisa ? "O que acontece a partir da imagem" : "Descreva a cena, o movimento e a câmera"} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={modelo ? (modelo.req?.nome ?? modelo.name) : "Modelo"} icone={<Cubo size={13} color={c.muted} />}
                    cor={modelo?.falta?.length ? c.amber : undefined} onPress={() => setFolha("modelo")} max={150} />
              {!!o && (
                <Chip rotulo={`${o.width}×${o.height} · ${seg}s${(aj?.count ?? 1) > 1 ? ` · ×${aj?.count}` : ""}${est ? ` · ${est.minimo ? "≥" : "~"}${tempo(est.s * (aj?.count ?? 1))}` : ""}`}
                      onPress={() => setFolha("ajustes")} max={230} />
              )}
              {!!acel?.arquivos.length && <Chip rotulo={acelPronto ? "⚡" : "⚡ baixar"} ativo={acelerando} onPress={alternaAcel} />}
              <Chip rotulo={melhorando ? "melhorando…" : "✨ Melhorar"} onPress={melhora} />
            </ScrollView>
            <Pressable onPress={gera} disabled={!pode} style={[redondo, { opacity: pode ? 1 : 0.35 }]}><Enviar size={18} color="#000" /></Pressable>
          </View>
        </View>
      </View>

      <Folha aberta={folha === "modelo"} titulo="Modelo de vídeo" onFecha={() => setFolha(null)}>
        <Lista valor={aj?.modelo ?? ""} onEscolhe={(p) => { const m = st?.video_models.find((x) => x.path === p); if (m) escolheModelo(m); }}
               opcoes={(st?.video_models ?? []).map((m) => ({ id: m.path, rotulo: `${m.req?.nome ?? m.name}${m.falta?.length ? " !" : ""}`,
                 dica: m.falta?.length ? `Faltam: ${m.falta.join(", ")}` : `${m.name} · ${(m.req?.modos ?? ["t2v"]).join(" · ")}` }))} />
      </Folha>

      {aj && o && (
        <Folha aberta={folha === "ajustes"} titulo="Ajustes do vídeo" onFecha={() => setFolha(null)}>
          <Campo rotulo="Modo">
            <Seletor opcoes={MODOS.filter((m) => modos.includes(m.id)).map((m) => ({ id: m.id, rotulo: m.rotulo }))} valor={aj.modo} onMuda={(v) => muda({ modo: v })} />
          </Campo>
          <Campo rotulo="Tamanho">
            <Seletor opcoes={tamanhosDe(modelo?.req).map((t) => ({ id: t.id, rotulo: `${t.id} · ${t.w}×${t.h}` }))}
                     valor={tamanhosDe(modelo?.req).find((t) => t.w === o.width && t.h === o.height)?.id ?? ""}
                     onMuda={(id) => { const t = tamanhosDe(modelo?.req).find((x) => x.id === id)!; mudaO({ width: t.w, height: t.h }); }} />
          </Campo>
          <Campo rotulo="Duração" dica={`${o.frames} quadros a ${o.fps} fps. Acima do treino do modelo o Wan degrada.`}>
            <Seletor opcoes={duracoesDe(modelo?.req, o.fps).map((d) => ({ id: String(d), rotulo: `${d} s` }))}
                     valor={String(duracoesDe(modelo?.req, o.fps).find((d) => quadrosDe(d, o.fps) === o.frames) ?? "")}
                     onMuda={(v) => mudaO({ frames: quadrosDe(Number(v), o.fps) })} />
          </Campo>
          <Campo rotulo="Variações"><Contador valor={aj.count} min={1} max={20} onMuda={(n) => muda({ count: n })} /></Campo>
          <Campo rotulo="Negativo">
            <TextInput style={s.input} value={o.negative ?? ""} onChangeText={(t) => mudaO({ negative: t })} multiline
                       placeholder="O que evitar no vídeo" placeholderTextColor={c.faint} />
          </Campo>
          <Campo rotulo="Quadros" dica="Sempre 4k+1."><Contador valor={o.frames} min={5} max={241} passo={4} onMuda={(n) => mudaO({ frames: n })} /></Campo>
          <Campo rotulo="FPS"><Contador valor={o.fps} min={8} max={30} onMuda={(n) => mudaO({ fps: n })} /></Campo>
          <Campo rotulo="Passos"><Contador valor={o.steps} min={1} max={100} onMuda={(n) => mudaO({ steps: n })} /></Campo>
          <Campo rotulo="CFG"><Contador valor={o.cfg} min={0} max={20} passo={0.5} onMuda={(n) => mudaO({ cfg: n })} /></Campo>
          <Campo rotulo="Flow shift" dica="0 = automático."><Contador valor={o.flow_shift ?? 0} min={0} max={20} passo={0.5} onMuda={(n) => mudaO({ flow_shift: n })} /></Campo>
          {(o.high_noise_steps ?? 0) !== 0 && (
            <Campo rotulo="Passos do HighNoise" dica="-1 = o sd.cpp divide entre os dois modelos.">
              <Contador valor={o.high_noise_steps ?? -1} min={-1} max={50} onMuda={(n) => mudaO({ high_noise_steps: n })} />
            </Campo>
          )}
          {!!st?.loras.filter((l) => l.wan && l.dim === modelo?.dim).length && (
            <Campo rotulo="LoRAs">
              {st!.loras.filter((l) => l.wan && l.dim === modelo?.dim).map((l) => {
                const on = o.loras?.find((x) => mesmo(x.path, l.path));
                return (
                  <Opcao key={l.path} rotulo={l.name} valor={!!on} dica={on ? `peso ${on.peso}` : undefined}
                         onMuda={(v) => mudaO({ loras: v ? [...(o.loras ?? []), { path: l.path, peso: 1 }] : (o.loras ?? []).filter((x) => !mesmo(x.path, l.path)) })} />
                );
              })}
            </Campo>
          )}
          <Campo rotulo="Sementes"><Seletor opcoes={SEMENTES} valor={aj.seed_mode} onMuda={(v) => muda({ seed_mode: v })} /></Campo>
          {aj.seed_mode !== "aleatoria" && (
            <Campo rotulo="Semente base" dica="0 = escolhe uma ao acaso."><Contador valor={aj.seed} min={0} max={2147483647} onMuda={(n) => muda({ seed: n })} /></Campo>
          )}
        </Folha>
      )}

      <Foco fila={fila} i={foco} onI={setFoco} onFecha={() => setFoco(null)} onAcao={acao} onFechaEAcao={(path, body) => { setFoco(null); acao(path, body); }}
            onSemente={(n) => { muda({ seed: n, seed_mode: "fixa", count: 1 }); setFoco(null); }} onErro={setErro} />
    </View>
  );
}

const redondo = { width: 36, height: 36, borderRadius: 18, backgroundColor: c.fg, alignItems: "center" as const, justifyContent: "center" as const };

function TomadaView({ t, onFoco, onAcao, onReaproveita, onContinua }: {
  t: Tomada; onFoco: (i: Img) => void; onAcao: (path: string, body?: unknown) => void; onReaproveita: () => void; onContinua: () => void;
}) {
  const { width } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const [aberto, setAberto] = useState(false);
  const o = t.msg.meta?.opts ?? {};
  const lado = width - 24 - (t.imgs.length > 1 ? 8 : 0); // espaço para a pilha à direita
  const alto = lado / Math.min(2.4, Math.max(0.5, (o.width ?? 16) / (o.height ?? 9)));
  const rodando = t.msg.status === "running";
  const refazer = t.imgs.filter((i) => REFAZIVEIS.includes(i.status)).length;
  const amp = o.ampliacao;
  const atual = t.imgs[Math.min(idx, t.imgs.length - 1)];
  return (
    <View style={{ gap: 10 }}>
      {!!t.user?.content && (
        <Pressable onPress={() => setAberto(!aberto)}
                   style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: c.raised, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={s.txt} numberOfLines={aberto ? undefined : 2}>{t.user.content}</Text>
        </Pressable>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {[o.width && `${o.width}×${o.height}`, o.frames && `${Math.round(((o.frames - 1) / (o.fps || 16)) * 10) / 10} s · ${o.fps} fps`,
          o.steps && `${o.steps} passos`, amp && `ampliado ${amp.fator}×`, o.loras?.length && `${o.loras.length} LoRA`, atual?.model_name]
          .filter(Boolean).map((x) => (
            <Text key={String(x)} style={{ color: c.faint, fontSize: 11.5, backgroundColor: c.raised, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>{x}</Text>
          ))}
      </View>
      {/* Um vídeo por vez, na proporção dele; as variações passam de lado (e empilham por trás, como nas imagens). */}
      <View style={{ marginTop: t.imgs.length > 1 ? 8 : 0 }}>
        {t.imgs.length > 2 && <View style={[pilha, { width: lado, transform: [{ translateX: 8 }, { translateY: -8 }, { rotate: "2deg" }], backgroundColor: "#232323" }]} />}
        {t.imgs.length > 1 && <View style={[pilha, { width: lado, transform: [{ translateX: 4 }, { translateY: -4 }, { rotate: "1deg" }], backgroundColor: "#2a2a2a" }]} />}
        <View style={{ width: lado, height: alto, borderRadius: 14, overflow: "hidden", backgroundColor: c.surface, borderColor: c.line, borderWidth: 1 }}>
          <FlatList data={t.imgs} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={(i) => i.path + i.seed}
                    onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / lado))}
                    renderItem={({ item: img, index }) => (
                      <Pressable onPress={() => pronto(img) && onFoco(img)} style={{ width: lado, height: alto }}>
                        {/* Só a da vez carrega o <video> (WebView): antes era um por variação, e a lista travava. */}
                        {pronto(img) && index === idx ? <VideoWeb path={img.path} quadro /> :
                         img.status === "gerando" && img.preview ? <Image source={{ uri: urlImagem(img.preview, String(img.progress ?? 0)) }} style={{ flex: 1 }} resizeMode="cover" fadeDuration={0} /> : (
                          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#111" }}>
                            {["gerando", "pendente"].includes(img.status) && <ActivityIndicator color={c.muted} />}
                            {img.status === "gerando" && !img.progress && <Text style={[s.faint, { fontSize: 12 }]}>carregando o modelo…</Text>}
                          </View>
                        )}
                        {pronto(img) && (
                          <View style={{ position: "absolute", left: 10, top: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: "#000a",
                                         alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: "#fff", fontSize: 14, marginLeft: 2 }}>▶</Text>
                          </View>
                        )}
                        {img.status === "mantida" && (
                          <Text style={{ position: "absolute", right: 10, top: 12, color: "#6ee7b7", fontSize: 12, fontWeight: "600",
                                         backgroundColor: "#000a", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>mantido</Text>
                        )}
                        {(!pronto(img) || rodando) && !!ROTULO[img.status] && (
                          <View style={{ position: "absolute", left: 8, bottom: 8, right: 8, backgroundColor: "#000b", borderRadius: 10, padding: 8 }}>
                            <Text style={{ color: img.status === "erro" ? c.red : c.fg, fontSize: 12.5 }} numberOfLines={3}>
                              {ROTULO[img.status]}{img.status === "gerando" && img.progress != null ? ` ${Math.round(img.progress * 100)}%` : ""}
                              {img.status === "gerando" && img.s_passo ? ` · ${img.s_passo.toFixed(1)} s/passo` : ""}
                              {img.status === "gerando" && img.restante ? ` · ~${tempo(img.restante)}` : ""}{img.error ? ` · ${img.error.split("\n")[0]}` : ""}
                            </Text>
                            {img.status === "gerando" && (
                              <View style={{ height: 3, backgroundColor: c.line, borderRadius: 2, marginTop: 5 }}>
                                <View style={{ height: 3, width: `${Math.round((img.progress ?? 0) * 100)}%`, backgroundColor: c.fg, borderRadius: 2 }} />
                              </View>
                            )}
                          </View>
                        )}
                      </Pressable>
                    )} />
          {t.imgs.length > 1 && (
            <Text style={{ position: "absolute", right: 10, bottom: 10, color: "#fff", fontSize: 12, backgroundColor: "#000a", borderRadius: 8,
                           paddingHorizontal: 7, paddingVertical: 3 }}>{idx + 1}/{t.imgs.length}</Text>
          )}
        </View>
        {t.imgs.length > 1 && (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 8 }}>
            {t.imgs.map((i, k) => (
              <View key={k} style={{ width: k === idx ? 14 : 6, height: 6, borderRadius: 3,
                                     backgroundColor: k === idx ? c.fg : i.status === "descartada" ? c.line : c.faint }} />
            ))}
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {rodando && (
          <Pressable style={[s.btnSec, { flexDirection: "row", gap: 6, alignItems: "center" }]} onPress={() => onAcao(`/imagens/${t.msg.id}/cancelar`)}>
            <Parar size={13} /><Text style={s.btnSecTxt}>Cancelar</Text>
          </Pressable>
        )}
        {!rodando && refazer > 0 && <Pressable style={s.btnSec} onPress={onContinua}><Text style={s.btnSecTxt}>Gerar as que faltaram ({refazer})</Text></Pressable>}
        {!rodando && !amp && <Pressable style={s.btnSec} onPress={onReaproveita}><Text style={s.btnSecTxt}>Reaproveitar</Text></Pressable>}
      </View>
    </View>
  );
}

/** Player em tela cheia: anda por todos os vídeos prontos. Manter e Descartar já passam ao próximo (triagem com
 * o polegar, como M/X no desktop); salvar, ampliar e semente ficam na linha de baixo. */
function Foco({ fila, i, onI, onFecha, onAcao, onFechaEAcao, onSemente, onErro }: {
  fila: { img: Img; mid: number; t: Tomada }[]; i: number | null; onI: (i: number) => void; onFecha: () => void;
  onAcao: (path: string, body?: unknown) => Promise<unknown>; onFechaEAcao: (path: string, body?: unknown) => void;
  onSemente: (n: number) => void; onErro: (e: string) => void;
}) {
  const inset = useSafeAreaInsets();
  const [ampliar, setAmpliar] = useState(false);
  const [salvar, setSalvar] = useState(false);
  const [amp, setAmp] = useState<{ modelos: { path: string; name: string }[]; ffmpeg: string } | null>(null);
  const [cfgAmp, setCfgAmp] = useState({ fator: 2, modelo: "", suavizar: false });
  useEffect(() => {
    if (!ampliar || amp) return;
    api.get<{ no_disco: { path: string; name: string }[]; ffmpeg: string }>("/local/video/ampliadores", 20000)
      .then((r) => {
        setAmp({ modelos: r.no_disco, ffmpeg: r.ffmpeg });
        const x2 = r.no_disco.find((m) => /x2/i.test(m.name)) ?? r.no_disco[0];
        setCfgAmp((c0) => ({ ...c0, modelo: x2?.path ?? "" }));
      }).catch((e) => onErro(e.message));
  }, [ampliar]);
  if (i == null || !fila.length) return null;
  const k = Math.min(i, fila.length - 1);
  const { img, mid, t } = fila[k];
  const o = t.msg.meta?.opts ?? {};
  const proximo = () => (k + 1 < fila.length ? onI(k + 1) : onFecha());
  async function paraDestino(d: Destino) {
    setSalvar(false);
    try { const aviso = await salva([img.path], d, "video/webm"); if (aviso) pergunta("Vídeo salvo", aviso, [{ texto: "Ok" }]); }
    catch (e: any) { if (!/cancel/i.test(String(e?.message))) onErro(e.message); }
  }
  const redondoSec = { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.line, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <Modal visible animationType="slide" onRequestClose={onFecha} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: inset.top }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          <Pressable onPress={onFecha} hitSlop={10} style={{ padding: 10 }}><Voltar size={22} /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 14 }} numberOfLines={1}>{t.user?.content ?? "Vídeo"}</Text>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>
              {k + 1}/{fila.length} · {img.model_name} · semente {img.seed}{o.width ? ` · ${o.width}×${o.height}` : ""}
            </Text>
          </View>
          {img.status === "mantida" && <Text style={{ color: "#6ee7b7", fontSize: 12, fontWeight: "600", marginRight: 8 }}>mantido</Text>}
        </View>
        <View style={{ flex: 1 }}><VideoWeb key={img.path} path={img.path} /></View>
        <View style={{ padding: 12, paddingBottom: inset.bottom + 12, gap: 12 }}>
          {/* Triagem: os dois botões grandes, e as setas para andar sem decidir. */}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Pressable style={[redondoSec, k === 0 && { opacity: 0.3 }]} disabled={k === 0} onPress={() => onI(k - 1)}><Text style={{ color: c.fg, fontSize: 18 }}>‹</Text></Pressable>
            <Pressable style={[s.btnSec, { flex: 1, alignItems: "center", paddingVertical: 12 }]}
                       onPress={() => pergunta("Descartar vídeo", "Vai para descartadas e some depois de alguns dias.", [
                         { texto: "Cancelar", estilo: "cancelar" },
                         // descartado sai da fila: o mesmo índice já é o próximo
                         { texto: "Descartar", estilo: "perigo", acao: () => { onAcao(`/imagens/${mid}/decidir`, { keep: [], apenas: [img.path] }); if (fila.length === 1) onFecha(); } }])}>
              <Text style={s.btnSecTxt}>Descartar</Text>
            </Pressable>
            <Pressable style={[s.btn, { flex: 1, alignItems: "center", paddingVertical: 12 }, img.status === "mantida" && { opacity: 0.4 }]}
                       disabled={img.status === "mantida"}
                       onPress={() => { onAcao(`/imagens/${mid}/decidir`, { keep: [img.path], apenas: [img.path] }); proximo(); }}>
              <Text style={s.btnTxt}>{img.status === "mantida" ? "Mantido" : "Manter"}</Text>
            </Pressable>
            <Pressable style={[redondoSec, k + 1 >= fila.length && { opacity: 0.3 }]} disabled={k + 1 >= fila.length} onPress={() => onI(k + 1)}><Text style={{ color: c.fg, fontSize: 18 }}>›</Text></Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
            <Pressable style={s.btnSec} onPress={() => setSalvar(true)}><Text style={s.btnSecTxt}>Salvar</Text></Pressable>
            {!o.ampliacao && <Pressable style={s.btnSec} onPress={() => setAmpliar(true)}><Text style={s.btnSecTxt}>Ampliar</Text></Pressable>}
            <Pressable style={s.btnSec} onPress={() => onSemente(img.seed)}><Text style={s.btnSecTxt}>Refazer semente</Text></Pressable>
          </View>
        </View>
        <Folha aberta={salvar} titulo="Salvar vídeo" onFecha={() => setSalvar(false)}>
          <Lista<Destino> valor={"" as Destino} onEscolhe={paraDestino} opcoes={[
            { id: "galeria", rotulo: "Galeria", dica: "Junto dos vídeos da câmera (DCIM)" },
            { id: "pasta", rotulo: "Escolher pasta…", dica: "Qualquer pasta do celular ou do cartão" },
            { id: "compartilhar", rotulo: "Compartilhar…", dica: "WhatsApp, Drive, e-mail ou outro app" },
          ]} />
        </Folha>
        <Folha aberta={ampliar} titulo="Ampliar vídeo" onFecha={() => setAmpliar(false)}>
          {!amp ? <ActivityIndicator color={c.muted} /> : !amp.ffmpeg ? (
            <Text style={s.muted}>Falta o ffmpeg no PC: instale em Configurações › Runtime, no desktop.</Text>
          ) : (
            <>
              <Campo rotulo="Fator"><Seletor opcoes={[{ id: "2", rotulo: "2×" }, { id: "4", rotulo: "4×" }]} valor={String(cfgAmp.fator)}
                                             onMuda={(v) => setCfgAmp({ ...cfgAmp, fator: Number(v) })} /></Campo>
              <Campo rotulo="Método" dica="ESRGAN fica mais nítido; Lanczos é rápido.">
                <Seletor opcoes={[...amp.modelos.map((m) => ({ id: m.path, rotulo: m.name })), { id: "", rotulo: "Rápido (Lanczos)" }]}
                         valor={cfgAmp.modelo} onMuda={(v) => setCfgAmp({ ...cfgAmp, modelo: v })} />
              </Campo>
              <Opcao rotulo="Suavizar movimento" dica="Dobra os fps interpolando quadros." valor={cfgAmp.suavizar}
                     onMuda={(v) => setCfgAmp({ ...cfgAmp, suavizar: v })} />
              <Pressable style={s.btn} onPress={() => { setAmpliar(false); onFechaEAcao(`/imagens/${mid}/ampliar`, { path: img.path, ...cfgAmp }); }}>
                <Text style={s.btnTxt}>Ampliar {cfgAmp.fator}×</Text>
              </Pressable>
            </>
          )}
        </Folha>
      </View>
    </Modal>
  );
}
