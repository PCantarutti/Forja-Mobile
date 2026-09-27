import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Linking, Modal, Pressable, ScrollView, StatusBar, View, useWindowDimensions } from "react-native";
import { Text, TextInput } from "./Texto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { api, base, enviaArquivo, lerAjustes, type Msg, salvaAjustes, urlImagem } from "./api";
import type { Conv } from "./Chat";
import { pergunta } from "./Dialogo";
import { Check, Clock, Cube, Download, Edit, Expandir, ExternalLink, Folder, Imagem, Play, Plus, Raio, Repetir, Seta, Sliders, Square, Trash,
         Trocar, Voltar, X } from "./icones";
import { ArquivosPC, CampoMelhorar, encaixa, Formato, modeloMelhorar, razao } from "./Formato";
import { AcaoGrade, AMOSTRADORES, BotaoEnviar, CampoSemente, type Destino, LinhaEstimativa, Miniatura, salva } from "./Imagens";
import Liquido from "./Liquido";
import { restante, velocidade } from "./progresso";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Area, Botao, BotaoIcone, Campo, CartaoOpcao, Chip, Contador, Deslizador, Folha, LinhaAjuste, Lista, Opcao, Quadrado, Radio,
         Recolhivel, ResumoEstimativa, Selo, Seletor, num, toast } from "./ui";

// Vídeo (Wan pelo stable-diffusion.cpp) = o motor dos lotes de imagem com conversa kind "video": mesmas rotas
// /imagens/*, arquivos .webm. Espelha o VideoView do desktop no que cabe no celular.
type Req = { nome?: string; modos?: string[]; multiplo?: number; resolucoes?: Record<string, [number, number]>; quadros_treino?: number; doc?: string };
type ModeloVid = { path: string; name: string; size?: number; params?: Record<string, any>; req?: Req; falta?: string[]; chave?: string; dim?: number };
type Lora = { path: string; name: string; wan?: boolean; dim?: number; passos?: number };
type Tempo = { model: string; w: number; h: number; frames: number; passos: number; s_passo: number; s_total: number };
type Opts = Record<string, any> & { steps: number; cfg: number; width: number; height: number; frames: number; fps: number;
                                    negative?: string; flow_shift?: number; high_noise_steps?: number; high_noise_cfg?: number;
                                    loras?: { path: string; peso: number }[] };
type LocalVid = { video: Opts; video_models: ModeloVid[]; loras: Lora[]; tempos_video: Tempo[]; image_busy?: boolean; runtimes: any;
                  gpu_video?: { nome?: string; gb?: number }; image?: Record<string, any>; video_dir?: string };
type Img = { path: string; seed: number; model_name?: string; status: string; progress?: number; preview?: string; com_previa?: boolean;
             restante?: number; s_passo?: number; error?: string; unidade?: string }; // unidade "quadro": ampliação
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
const REFAZIVEIS = ["interrompida", "pendente", "cancelada", "erro"];
const ROTULO: Record<string, string> = { pendente: "na fila", gerando: "gerando", erro: "erro", cancelada: "cancelada",
  interrompida: "interrompida", descartada: "descartada", mantida: "mantida", pronta: "" };
// Arquivos e ligações de memória são do modelo (IA local › Modelos): o padrão da aba não passa por cima (VideoView).
const DO_MODELO = ["model", "seed", "offload", "flash_attn", "vae_tiling", "te_cpu", "preview", "taesd", "vae", "clip_l", "t5xxl", "llm",
  "llm_vision", "clip_vision", "high_noise_model", "variante", "diffusion_model", "out_dir", "descarte_dias"];

// videoConta.ts do desktop: quadros 4k+1 (o VAE do Wan junta 4 em 1), tamanhos e durações a partir da variante.
const quadrosDe = (seg: number, fps: number) => Math.max(1, Math.round((seg * fps) / 4)) * 4 + 1;
// FORMAS_VIDEO sem as de retrato (saem do girar). Todas as qualidades aparecem; a que o modelo não treinou fica apagada.
const FORMAS = ["16:9", "1:1", "4:3"];
const QUALIDADES: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080, "4K": 2160 };
function tamanhoVideo(req: Req | undefined, f: string, q: string): [number, number] {
  const m = req?.multiplo ?? 16, enc = (v: number) => encaixa(v, m);
  const [w, h] = (req?.resolucoes ?? { "480p": [832, 480] })[q] ?? [(QUALIDADES[q] * 16) / 9, QUALIDADES[q]];
  if (f === "1:1") { const l = enc(Math.sqrt(w * h)); return [l, l]; }
  if (f === "4:3") return [enc((h * 4) / 3), enc(h)];
  return [enc(w), enc(h)];
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

/** WebM no <video> do WebView: o Android toca, e não precisa de player nativo novo. `quadro` = só o 1º quadro, mudo.
 * No player (sem `quadro`), a barra de tempo é nossa: o vídeo manda currentTime/duration e tocar nele pausa. */
const htmlVideo = (src: string, quadro: boolean) =>
  `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;height:100%;overflow:hidden}` +
  `video{width:100%;height:100%;object-fit:${quadro ? "cover" : "contain"}}</style></head><body>` +
  `<video id="v" src="${quadro ? `${src}#t=0.1` : src}" ${quadro ? 'muted playsinline preload="metadata"' : "autoplay loop playsinline"}></video>` +
  (quadro ? "" : `<script>var v=document.getElementById("v");v.onclick=function(){v.paused?v.play():v.pause()};` +
    `setInterval(function(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({t:v.currentTime,d:v.duration||0}))},250);</script>`) +
  `</body></html>`;

function VideoWeb({ path, quadro, onTempo, web }: { path: string; quadro?: boolean; onTempo?: (t: number, d: number) => void; web?: React.Ref<WebView> }) {
  return (
    <WebView ref={web} source={{ html: htmlVideo(urlImagem(path), !!quadro), baseUrl: base() }} originWhitelist={["*"]} style={{ flex: 1, backgroundColor: "#000" }}
             mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback scrollEnabled={false} pointerEvents={quadro ? "none" : "auto"}
             androidLayerType="hardware"
             onMessage={onTempo ? (e) => { try { const m = JSON.parse(e.nativeEvent.data); onTempo(m.t, m.d); } catch {} } : undefined} />
  );
}
const relogio = (sg: number) => `${Math.floor(sg / 60)}:${String(Math.floor(sg % 60)).padStart(2, "0")}`;

export default function Video({ conv, onCriada, onTurno, onBaixarModelos }:
  { conv: Conv | null; onCriada: (c: Conv) => void; onTurno: () => void; onBaixarModelos?: () => void }) {
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
  // Lote criado no PC (ou em outra janela) com nada rodando aqui: o carimbo da lista no /activity muda e a
  // conversa recarrega, como o Chat faz com o id do turno.
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
      const d = await modeloMelhorar("video");
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
  // Com uma geração rodando, a nova entra na fila do PC (um sd-cli por vez, na ordem).
  const pode = !!prompt.trim() && !!aj?.modelo && !semRuntime && refs.length >= precisa;
  const nomeModelo = modelo ? (modelo.req?.nome ?? modelo.name) : "Modelo";
  const tamPara = (f: string, q: string) => tamanhoVideo(modelo?.req, f, q);
  const qAtual = o ? Object.keys(QUALIDADES).find((q) => Math.min(...tamPara("16:9", q)) === Math.min(o.width, o.height)) : undefined;
  const treino = modelo?.req?.quadros_treino ?? 81;
  // Wan2.2 A14B: dois modelos (alto e baixo ruído), com passos e CFG próprios para o de alto ruído.
  const a14b = !!modelo?.params?.high_noise_model || /a14b/i.test(`${modelo?.params?.variante ?? ""} ${modelo?.req?.nome ?? ""}`);
  const gpu = st?.gpu_video?.gb ?? null;
  const vram = o && modelo ? vramVideo(modelo, o) : null;
  const passa = vram != null && gpu != null && vram > gpu;
  const pre = o ? predefVideo(o, acelerando) : undefined;
  const n = aj?.count ?? 1;
  const tempoEst = est ? `${est.minimo ? "≥" : "~"}${tempo(est.s)} cada${n > 1 ? ` · ~${tempo(est.s * n)} os ${n}` : ""}` : null;

  /** Predefinição do vídeo: Rápido liga o acelerador quando o modelo tem (4 passos, CFG 1); sem ele, 10 passos e CFG 5. */
  function aplicaPredef(id: string) {
    if (!o) return;
    if (id === "rapido" && acelPronto) { if (!acelerando) alternaAcel(); return; }
    const alvo = id === "rapido" ? { steps: 10, cfg: 5 } : id === "equilibrado" ? { steps: 20, cfg: 5 } : { steps: 30, cfg: 5 };
    if (acelerando) {
      const fora = (o.loras ?? []).filter((l) => !acelArquivos.some((p) => mesmo(p, l.path)));
      antesDoAcel.current = null;
      return mudaO({ ...alvo, loras: fora });
    }
    mudaO(alvo);
  }
  const estDe = (x: Partial<Opts>) => (o && st ? estimar(st.tempos_video ?? [], modelo?.chave, { ...o, ...x }) : null);

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
              {semRuntime || (st && !st.video_models.length) || !modelo || !o ? (
                <Text style={[s.muted, { textAlign: "center" }]}>
                  {semRuntime ? "Instale o stable-diffusion.cpp em IA local no desktop." :
                   st && !st.video_models.length ? "Nenhum modelo de vídeo no PC. Baixe um kit Wan em IA local › Vídeo, no desktop." :
                   "Descreva a cena, o movimento e a câmera."}
                </Text>
              ) : (
                <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12, textAlign: "center" }}>
                  {nomeModelo} · {o.width}×{o.height} · {num(seg)} s{est ? ` · ${est.minimo ? "≥" : "~"}${tempo(est.s)} cada` : ""}
                </Text>
              )}
            </View>
            {!semRuntime && !!st?.video_models.length && MODOS.filter((m) => modos.includes(m.id)).map((m) => (
              <Pressable key={m.id} onPress={() => { muda({ modo: m.id }); setPrompt(m.exemplo); }}
                         style={({ pressed }) => ({ backgroundColor: pressed ? c.raised : c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 16,
                                                    padding: 14, flexDirection: "row", gap: 12 })}>
                <Quadrado>{iconeModo(m.id, 17, c.muted)}</Quadrado>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>{m.rotulo}</Text>
                  <Text style={[s.faint, { fontSize: 12.5 }]}>{m.dica}</Text>
                  <Text style={[s.muted, { fontSize: 13, fontStyle: "italic" }]} numberOfLines={2}>“{m.exemplo}”</Text>
                </View>
              </Pressable>
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <TomadaView t={item} onFoco={(img) => setFoco(Math.max(0, fila.findIndex((f) => f.img.path === img.path)))} onAcao={acao} onReaproveita={() => reaproveita(item)}
                      onContinua={() => comVram((confirm) => api.post(`/imagens/${item.msg.id}/continuar`, { confirm }).then(carrega), "continuar")} />
        )}
      />
      {!!erro && <Text style={[s.muted, { color: c.err, paddingHorizontal: 14 }]} onPress={() => setErro("")}>{erro}</Text>}
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        {modos.length > 1 && (
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
            {MODOS.filter((m) => modos.includes(m.id)).map((m) => {
              const on = aj?.modo === m.id;
              return (
                <Pressable key={m.id} onPress={() => muda({ modo: m.id })}
                           style={{ flex: 1, height: 40, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: 12,
                                    borderWidth: 1, borderColor: on ? c.accentLine : c.line, backgroundColor: on ? c.accentSoft : "transparent" }}>
                  {iconeModo(m.id, 14, on ? c.accentText : c.muted)}
                  <Text style={{ color: on ? c.fg : c.muted, fontSize: 13, fontWeight: on ? "600" : "400" }}>{m.rotulo}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          {precisa > 0 && (
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4, paddingTop: 4, alignItems: "center" }}>
              {Array.from({ length: precisa }, (_, i) => {
                const rot = precisa === 1 ? "imagem" : i ? "fim" : "início";
                return refs[i] ? (
                  <View key={i} style={{ alignItems: "center", gap: 3 }}>
                    <Miniatura uri={urlImagem(refs[i])} lado={64} onTira={() => setRefs((x) => x.filter((_, j) => j !== i))} />
                    <Text style={{ color: c.faint, fontFamily: mono, fontSize: 10.5 }}>{rot}</Text>
                  </View>
                ) : (
                  <Pressable key={i} onPress={() => quadro(i)}
                             style={{ width: 64, height: 64, borderRadius: 10, borderColor: c.lineStrong, borderWidth: 1, borderStyle: "dashed",
                                      alignItems: "center", justifyContent: "center", gap: 3 }}>
                    <Plus size={15} color={c.muted} />
                    <Text style={[s.faint, { fontSize: 11 }]}>{rot}</Text>
                  </Pressable>
                );
              })}
              {precisa === 2 && refs.length === 2 && (
                <BotaoIcone lado={38} onPress={() => setRefs(([a, b]) => [b, a])}><Trocar size={16} color={c.fg} /></BotaoIcone>
              )}
            </View>
          )}
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={prompt}
                     onChangeText={setPrompt} multiline placeholderTextColor={c.faint}
                     placeholder={precisa ? "O que acontece a partir da imagem" : "Descreva a cena, o movimento e a câmera"} />
          {(tempoEst || vram != null) && (
            <LinhaEstimativa onPress={() => setFolha("ajustes")} passa={passa} tempo={tempoEst ?? "sem medição"}
                             vram={vram != null ? `${num(vram, 1)} GB de VRAM` : ""} />
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={nomeModelo} icone={<Cube size={14} color={modelo?.falta?.length ? c.warn : c.muted} />}
                    cor={modelo?.falta?.length ? c.warn : undefined} onPress={() => setFolha("modelo")} />
              {!!o && (
                <Chip rotulo={`${razao(o.width, o.height).join(":")}${qAtual ? ` · ${qAtual}` : ""}`} icone={<Sliders size={14} color={c.muted} />}
                      onPress={() => setFolha("ajustes")} />
              )}
              {!!o && <Chip rotulo={`${num(seg)} s${n > 1 ? ` · ×${n}` : ""}`} icone={<Clock size={14} color={c.muted} />} onPress={() => setFolha("ajustes")} />}
              {!!acel?.arquivos.length && (
                <Chip rotulo="Acelerar" ativo={acelerando} icone={<Raio size={14} color={acelerando ? c.accentText : c.muted} />} onPress={alternaAcel} />
              )}
              <Chip rotulo={melhorando ? "Melhorando…" : "Melhorar"} icone={<Edit size={14} color={c.muted} />} onPress={melhora} />
            </ScrollView>
            <BotaoEnviar pode={pode} onPress={gera} />
          </View>
        </View>
      </View>

      <Folha aberta={folha === "modelo"} titulo="Modelo de vídeo" onFecha={() => setFolha(null)}>
        <View style={{ gap: 8 }}>
          {(st?.video_models ?? []).map((m) => {
            const on = m.path === aj?.modelo;
            const temAcel = !!st?.loras.some((l) => l.wan && l.dim === m.dim && (l.passos ?? 0) > 0) || (on && !!acel?.arquivos.length);
            const e = o && st ? estimar(st.tempos_video ?? [], m.chave, o) : null;
            return (
              <Radio key={m.path} on={on} onPress={() => escolheModelo(m)}
                     rodape={m.falta?.length ? (
                       <View style={{ borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.warnSoft, paddingHorizontal: 12, paddingVertical: 8,
                                      flexDirection: "row", alignItems: "center", gap: 10 }}>
                         <Text style={{ color: c.warn, fontSize: 12.5, flex: 1 }}>Faltam: {m.falta.map((k) => ROTULO_ARQ[k] ?? k).join(", ")}</Text>
                         <Botao rotulo="Baixar" altura={34} icone={<Download size={13} color={c.fg} />} onPress={() => { setFolha(null); onBaixarModelos?.(); }} />
                       </View>
                     ) : undefined}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>{m.req?.nome ?? m.name}</Text>
                  {temAcel && <Raio size={13} color={c.accentText} />}
                </View>
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }} numberOfLines={1}>{m.path.split(/[\\/]/).pop()}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 2 }}>
                  {(m.req?.modos ?? ["t2v"]).map((x) => <Selo key={x} t={MODOS.find((y) => y.id === x)?.rotulo ?? x} />)}
                  <Selo emMono t={[m.size ? `${num(m.size / 2 ** 30, 1)} GB` : "", e ? `${e.minimo ? "≥" : "~"}${tempo(e.s)}` : ""].filter(Boolean).join(" · ")} />
                </View>
              </Radio>
            );
          })}
        </View>
        <Text style={[s.faint, { fontSize: 12 }]}>Escolher um modelo traz os ajustes sugeridos dele (passos, CFG, tamanho, duração).</Text>
      </Folha>

      {aj && o && (
        <Folha aberta={folha === "ajustes"} titulo="Ajustes do vídeo" onFecha={() => setFolha(null)}
               fixo={<ResumoEstimativa gpu={gpu} vram={vram} tempo={tempoEst}
                                       linha={`${o.width}×${o.height} · ${o.frames} quadros · ${o.fps} fps · ${o.steps} passos`}
                                       estouro="Passa da VRAM da GPU: o sd.cpp descarrega partes para a RAM e fica bem mais lento." />}>
          <Campo rotulo="Predefinição">
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[{ id: "rapido", nome: "Rápido", sub: acelPronto ? "4 passos" : "10 passos", x: acelPronto ? { steps: 4, cfg: 1 } : { steps: 10, cfg: 5 } },
                { id: "equilibrado", nome: "Equilibrado", sub: "20 passos", x: { steps: 20, cfg: 5 } },
                { id: "qualidade", nome: "Qualidade", sub: "30 passos", x: { steps: 30, cfg: 5 } }].map((p) => {
                const e = estDe(p.x);
                return <CartaoOpcao key={p.id} titulo={p.nome} sub={p.sub} extra={e ? `${e.minimo ? "≥" : "~"}${tempo(e.s)}` : undefined}
                                    on={pre === p.id} onPress={() => aplicaPredef(p.id)} />;
              })}
            </View>
          </Campo>
          {modos.length > 1 && (
            <Campo rotulo="Modo">
              <Seletor cheio opcoes={MODOS.filter((m) => modos.includes(m.id)).map((m) => ({ id: m.id, rotulo: m.rotulo }))} valor={aj.modo} onMuda={(v) => muda({ modo: v })} />
            </Campo>
          )}
          <Formato formas={FORMAS} tamanhoPara={tamPara} w={o.width} h={o.height} mult={modelo?.req?.multiplo ?? 16}
                   quals={Object.keys(QUALIDADES).map((q) => ({ id: q, off: !!modelo?.req?.resolucoes && !(q in modelo.req.resolucoes) }))}
                   onMuda={(w, h) => mudaO({ width: w, height: h })}
                   dicaQual="Acima do que o modelo treinou: pode sair com artefatos e demora bem mais." />
          <Deslizador rotulo="Duração" valor={o.frames} min={quadrosDe(1, o.fps)} max={Math.max(quadrosDe((treino * 2) / (o.fps || 16), o.fps), o.frames)} passo={4}
                      fmt={(k) => `${num(Math.round(((k - 1) / (o.fps || 16)) * 10) / 10)} s`} onMuda={(k) => mudaO({ frames: k })}
                      dica={`${o.frames} quadros a ${o.fps} fps. Treinado com até ${num(Math.round(((treino - 1) / (o.fps || 16)) * 10) / 10)} s: acima disso o Wan degrada.`} />
          <LinhaAjuste rotulo="Variações" sub="Cada uma soma o tempo inteiro">
            <Contador valor={aj.count} min={1} max={20} onMuda={(k) => muda({ count: k })} />
          </LinhaAjuste>
          <Campo rotulo="Negativo">
            <Area valor={o.negative ?? ""} onMuda={(t) => mudaO({ negative: t })} placeholder="O que evitar no vídeo" />
          </Campo>
          <Recolhivel titulo="Avançado" sub={`${o.steps} passos · CFG ${num(o.cfg)} · ${o.fps} fps`}>
            <Deslizador rotulo="Passos" valor={o.steps} min={1} max={50} onMuda={(k) => mudaO({ steps: k })}
                        dica={acelerando ? "O acelerador está ligado: acima de 8 passos ele perde o sentido." : undefined} />
            <Deslizador rotulo="CFG" valor={o.cfg} min={0} max={12} passo={0.5} onMuda={(k) => mudaO({ cfg: k })} />
            <Campo rotulo="Amostrador">
              <Seletor rolavel opcoes={AMOSTRADORES.map((a) => ({ id: a, rotulo: a }))} valor={o.sampler ?? "euler"} onMuda={(v) => mudaO({ sampler: v })} />
            </Campo>
            <Deslizador rotulo="Flow shift" valor={o.flow_shift ?? 0} min={0} max={12} passo={0.5} onMuda={(k) => mudaO({ flow_shift: k })}
                        fmt={(k) => (k ? num(k) : "auto")} dica="0 = automático." />
            <Deslizador rotulo="FPS" valor={o.fps} min={8} max={30} onMuda={(k) => mudaO({ fps: k, frames: quadrosDe(seg, k) })}
                        dica={`${o.frames} quadros (sempre 4k+1). Mais fps com a mesma duração pede mais quadros.`} />
            {a14b && (
              <>
                <Deslizador rotulo="Passos alto ruído" valor={o.high_noise_steps ?? -1} min={-1} max={50} onMuda={(k) => mudaO({ high_noise_steps: k })}
                            fmt={(k) => (k < 0 ? "auto" : String(k))} dica="-1 = automático: o sd.cpp divide entre os dois modelos." />
                <Deslizador rotulo="CFG alto ruído" valor={o.high_noise_cfg ?? 0} min={0} max={12} passo={0.5} onMuda={(k) => mudaO({ high_noise_cfg: k })}
                            fmt={(k) => (k ? num(k) : "o mesmo")} dica="0 = o mesmo CFG do modelo de baixo ruído." />
              </>
            )}
            {!!st?.loras.filter((l) => l.wan && l.dim === modelo?.dim).length && (
              <Campo rotulo="LoRAs">
                <View style={{ gap: 12 }}>
                  {st!.loras.filter((l) => l.wan && l.dim === modelo?.dim).map((l) => {
                    const on = o.loras?.find((x) => mesmo(x.path, l.path));
                    const eAcel = acelArquivos.some((p) => mesmo(p, l.path));
                    return (
                      <View key={l.path} style={{ gap: 8 }}>
                        <Opcao rotulo={l.name} valor={!!on} sub={[eAcel ? "acelerador" : "", l.passos ? `${l.passos} passos` : ""].filter(Boolean).join(" · ") || undefined}
                               onMuda={(v) => mudaO({ loras: v ? [...(o.loras ?? []), { path: l.path, peso: 1 }] : (o.loras ?? []).filter((x) => !mesmo(x.path, l.path)) })} />
                        {on && (
                          <Deslizador rotulo="Peso" valor={on.peso} min={0} max={2} passo={0.1} casas={1}
                                      onMuda={(k) => mudaO({ loras: (o.loras ?? []).map((x) => (mesmo(x.path, l.path) ? { ...x, peso: Math.round(k * 10) / 10 } : x)) })} />
                        )}
                      </View>
                    );
                  })}
                </View>
              </Campo>
            )}
            <Campo rotulo="Sementes"><Seletor cheio opcoes={SEMENTES} valor={aj.seed_mode} onMuda={(v) => muda({ seed_mode: v })} /></Campo>
            {aj.seed_mode !== "aleatoria" && <CampoSemente valor={aj.seed} onMuda={(k) => muda({ seed: k })} />}
            {!!modelo?.req?.doc && (
              <Pressable onPress={() => Linking.openURL(modelo.req!.doc!)} hitSlop={6}>
                <Text style={{ color: c.accentText, fontSize: 13 }}>Guia do sd.cpp para este modelo</Text>
              </Pressable>
            )}
          </Recolhivel>
          <CampoMelhorar aba="video" />
          <ArquivosPC pasta={st?.video_dir ?? ""} onPasta={(p) => api.put("/local/paths", { video_dir: p }).then(() => { setSt((x) => x && { ...x, video_dir: p }); toast("Pasta salva no PC."); })
                                                               .catch((e) => toast(e.message))}
                      dias={st?.image?.descarte_dias ?? 7} onDias={(k) => {
                        setSt((x) => x && { ...x, image: { ...x.image, descarte_dias: k } });
                        api.put("/local/image/defaults", { ...st?.image, descarte_dias: k }).catch((e) => toast(e.message));
                      }} />
        </Folha>
      )}

      <Foco fila={fila} i={foco} onI={setFoco} onFecha={() => setFoco(null)} onAcao={acao} onFechaEAcao={(path, body) => { setFoco(null); acao(path, body); }}
            onSemente={(k) => { muda({ seed: k, seed_mode: "fixa", count: 1 }); setFoco(null); }} onErro={setErro} />
    </View>
  );
}

const ROTULO_ARQ: Record<string, string> = { vae: "VAE", t5xxl: "umt5-xxl", clip_l: "clip_l", llm: "codificador", clip_vision: "CLIP Vision",
  high_noise_model: "modelo HighNoise" };
const iconeModo = (id: string, size: number, color: string) =>
  id === "t2v" ? <Edit size={size} color={color} /> : id === "i2v" ? <Imagem size={size} color={color} /> : <Trocar size={size} color={color} />;

// ponytail: VRAM provisória (peso do modelo + ativações proporcionais a w·h·quadros); trocar por medição quando o PC expuser.
function vramVideo(m: ModeloVid, o: Opts) {
  const gb = (m.size ?? 0) / 2 ** 30;
  return gb + 1.5 * ((o.width * o.height * o.frames) / (832 * 480 * 81));
}
function predefVideo(o: Opts, acelerando: boolean) {
  if (acelerando) return "rapido";
  if (o.cfg !== 5) return undefined;
  return o.steps === 10 ? "rapido" : o.steps === 20 ? "equilibrado" : o.steps === 30 ? "qualidade" : undefined;
}


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
            <Text key={String(x)} style={{ color: c.faint, fontFamily: mono, fontSize: 11.5, backgroundColor: c.raised, borderRadius: 5, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 }}>{x}</Text>
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
                            {img.status === "pendente" && <ActivityIndicator color={c.muted} />}
                            {img.status === "gerando" && !img.progress && <Text style={[s.faint, { fontSize: 12 }]}>carregando o modelo…</Text>}
                          </View>
                        )}
                        {/* sem prévia ao vivo: o líquido do desktop sobe com o progresso */}
                        {img.status === "gerando" && !img.preview && <Liquido fracao={img.progress ?? 0} largura={lado} />}
                        {pronto(img) && (
                          <View style={{ position: "absolute", left: 10, top: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: "#000a",
                                         alignItems: "center", justifyContent: "center" }}>
                            <Play size={15} color="#fff" />
                          </View>
                        )}
                        {img.status === "mantida" && (
                          <Text style={{ position: "absolute", right: 10, top: 12, color: c.ok, fontSize: 12, fontWeight: "600",
                                         backgroundColor: "#000a", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>mantido</Text>
                        )}
                        {(!pronto(img) || rodando) && !!ROTULO[img.status] && (
                          <View style={{ position: "absolute", left: 8, bottom: 8, right: 8, backgroundColor: "#000b", borderRadius: 10, padding: 8 }}>
                            <Text style={{ color: img.status === "erro" ? c.red : c.fg, fontSize: 12.5 }} numberOfLines={3}>
                              {ROTULO[img.status]}{img.status === "gerando" && img.progress != null ? ` ${Math.round(img.progress * 100)}%` : ""}
                              {img.status === "gerando" && img.s_passo ? ` · ${velocidade(img.s_passo, img.unidade === "quadro" ? "quadro" : "passo")}` : ""}
                              {img.status === "gerando" && img.restante ? ` · ${restante(img.restante)}` : ""}{img.error ? ` · ${img.error.split("\n")[0]}` : ""}
                            </Text>
                            {img.status === "gerando" && (
                              <View style={{ height: 3, backgroundColor: c.line, borderRadius: 2, marginTop: 5 }}>
                                <View style={{ height: 3, width: `${Math.round((img.progress ?? 0) * 100)}%`, backgroundColor: c.accent, borderRadius: 2 }} />
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
                                     backgroundColor: k === idx ? c.accent : i.status === "descartada" ? c.line : c.faint }} />
            ))}
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {rodando && <Botao rotulo="Cancelar" icone={<Square size={12} color={c.fg} />} onPress={() => onAcao(`/imagens/${t.msg.id}/cancelar`)} />}
        {!rodando && refazer > 0 && <Botao rotulo={`Gerar as que faltaram (${refazer})`} icone={<Repetir size={14} color={c.fg} />} onPress={onContinua} />}
        {!rodando && !amp && <Botao rotulo="Reaproveitar" icone={<Repetir size={14} color={c.fg} />} onPress={onReaproveita} />}
      </View>
    </View>
  );
}

/** Player em tela cheia: anda por todos os vídeos prontos. Manter e Descartar já passam ao próximo (triagem com
 * o polegar, como M/X no desktop); salvar, ampliar e semente ficam na grade de baixo. */
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
  const [tempoV, setTempoV] = useState({ t: 0, d: 0 });
  const [larguraBarra, setLarguraBarra] = useState(0);
  const web = useRef<WebView>(null);
  const { width: larg, height: alt } = useWindowDimensions();
  const deitado = larg > alt; // celular girado: só o vídeo, a barra de tempo e o X
  useEffect(() => {
    if (!ampliar || amp) return;
    api.get<{ no_disco: { path: string; name: string; tipo?: string }[]; ffmpeg: string }>("/local/video/ampliadores", 20000)
      .then((r) => {
        const esrgan = r.no_disco.filter((m) => (m.tipo ?? "esrgan") === "esrgan");
        setAmp({ modelos: esrgan, ffmpeg: r.ffmpeg });
        const x2 = esrgan.find((m) => /x2/i.test(m.name)) ?? esrgan[0];
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
    try { const aviso = await salva([img.path], d, "video/webm"); if (aviso) toast(aviso); }
    catch (e: any) { if (!/cancel/i.test(String(e?.message))) onErro(e.message); }
  }
  const mantido = img.status === "mantida";
  const seta = (dir: -1 | 1) => {
    const ativa = dir < 0 ? k > 0 : k + 1 < fila.length;
    return (
      <BotaoIcone lado={44} fundo="transparent" borda={c.line} desabilitado={!ativa} onPress={() => onI(k + dir)}>
        {dir < 0 ? <Voltar size={20} color={c.fg} /> : <Seta size={20} color={c.fg} />}
      </BotaoIcone>
    );
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onFecha} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      <StatusBar hidden={deitado} />
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: deitado ? 0 : inset.top }}>
        {deitado && (
          <BotaoIcone lado={44} fundo="#0009" onPress={onFecha} estilo={{ position: "absolute", top: 12, left: 12 + inset.left, zIndex: 2 }}>
            <X size={22} color="#fff" />
          </BotaoIcone>
        )}
        {!deitado && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          <BotaoIcone lado={44} fundo="transparent" onPress={onFecha}><X size={22} color={c.fg} /></BotaoIcone>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 14 }} numberOfLines={1}>{t.user?.content ?? "Vídeo"}</Text>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>
              {k + 1} de {fila.length} · {img.model_name} · semente {img.seed}{o.width ? ` · ${o.width}×${o.height}` : ""}
            </Text>
          </View>
          {mantido && <Text style={{ color: c.ok, fontSize: 12, fontWeight: "600", marginRight: 8 }}>mantido</Text>}
        </View>}
        {/* contido nos dois eixos (object-fit contain no <video>): um 9:16 não empurra o rodapé */}
        <View style={{ flex: 1, minHeight: 0 }}>
          <VideoWeb key={img.path} path={img.path} web={web} onTempo={(tt, d) => setTempoV({ t: tt, d })} />
        </View>
        <View style={{ paddingHorizontal: 14 + (deitado ? inset.left : 0), paddingTop: 10, paddingBottom: deitado ? 10 : 0, gap: 6 }}>
          <Pressable onLayout={(e) => setLarguraBarra(e.nativeEvent.layout.width)} hitSlop={10}
                     onPress={(e) => { if (tempoV.d && larguraBarra) web.current?.injectJavaScript(`v.currentTime=${(e.nativeEvent.locationX / larguraBarra) * tempoV.d};true;`); }}
                     style={{ height: 3, borderRadius: 2, backgroundColor: c.line }}>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: c.accent, width: `${tempoV.d ? Math.min(100, (tempoV.t / tempoV.d) * 100) : 0}%` }} />
          </Pressable>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{relogio(tempoV.t)}</Text>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>{relogio(tempoV.d)}</Text>
          </View>
        </View>
        {!deitado && <View style={{ padding: 12, paddingBottom: inset.bottom + 12, gap: 10 }}>
          {/* Triagem: os dois botões grandes, e as setas para andar sem decidir. */}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            {seta(-1)}
            <Botao flex altura={48} rotulo="Descartar" icone={<Trash size={16} color={c.fg} />}
                   onPress={() => pergunta("Descartar vídeo", "Vai para descartadas e some depois de alguns dias.", [
                     { texto: "Cancelar", estilo: "cancelar" },
                     // descartado sai da fila: o mesmo índice já é o próximo
                     { texto: "Descartar", estilo: "perigo", acao: () => {
                       onAcao(`/imagens/${mid}/decidir`, { keep: [], apenas: [img.path] });
                       toast("Foi para descartadas. Some depois de alguns dias.");
                       if (fila.length === 1) onFecha();
                     } }])} />
            <Botao flex primario altura={48} rotulo={mantido ? "Mantido" : "Manter"} icone={<Check size={16} color={c.accentFg} />}
                   estilo={mantido && { opacity: 0.45 }} desabilitado={mantido}
                   onPress={() => { onAcao(`/imagens/${mid}/decidir`, { keep: [img.path], apenas: [img.path] }); proximo(); }} />
            {seta(1)}
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <AcaoGrade altura={60} rotulo="Salvar" icone={<Download size={18} color={c.fg} />} onPress={() => setSalvar(true)} />
            {!o.ampliacao && <AcaoGrade altura={60} rotulo="Ampliar" icone={<Expandir size={18} color={c.fg} />} onPress={() => setAmpliar(true)} />}
            <AcaoGrade altura={60} rotulo="Refazer semente" icone={<Repetir size={18} color={c.fg} />} onPress={() => onSemente(img.seed)} />
          </View>
        </View>}
        <Folha aberta={salvar} titulo="Salvar vídeo" onFecha={() => setSalvar(false)}>
          <Lista<Destino> valor={"" as Destino} onEscolhe={paraDestino} opcoes={[
            { id: "galeria", rotulo: "Galeria", dica: "Junto dos vídeos da câmera (DCIM)", icone: <Download size={17} color={c.muted} /> },
            { id: "pasta", rotulo: "Escolher pasta…", dica: "Qualquer pasta do celular ou do cartão", icone: <Folder size={17} color={c.muted} /> },
            { id: "compartilhar", rotulo: "Compartilhar…", dica: "WhatsApp, Drive, e-mail ou outro app", icone: <ExternalLink size={17} color={c.muted} /> },
          ]} />
        </Folha>
        <Folha aberta={ampliar} titulo="Ampliar vídeo" onFecha={() => setAmpliar(false)}>
          {!amp ? <ActivityIndicator color={c.muted} /> : !amp.ffmpeg ? (
            <Text style={s.muted}>Falta o ffmpeg no PC: instale em Configurações › Runtime, no desktop.</Text>
          ) : (
            <>
              <Campo rotulo="Método" dica="IA roda na GPU do PC; Lanczos é instantâneo, sem inventar detalhe.">
                <View style={{ gap: 8 }}>
                  {[...amp.modelos.map((m) => ({ id: m.path, nome: m.name, dica: "IA (ESRGAN)", selo: "segundos" })),
                    { id: "", nome: "Lanczos", dica: "Rápido, sem IA", selo: "instantâneo" }].map((m) => (
                    <Radio key={m.id} on={cfgAmp.modelo === m.id} onPress={() => setCfgAmp({ ...cfgAmp, modelo: m.id })}
                           direita={<Selo t={m.selo} emMono borda />}>
                      <Text style={{ color: c.fg, fontSize: 14.5 }} numberOfLines={1}>{m.nome}</Text>
                      <Text style={{ color: c.muted, fontSize: 12.5 }}>{m.dica}</Text>
                    </Radio>
                  ))}
                </View>
              </Campo>
              <Campo rotulo="Fator">
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[2, 4].map((f) => (
                    <CartaoOpcao key={f} altura={60} titulo={`${f}×`} on={cfgAmp.fator === f} onPress={() => setCfgAmp({ ...cfgAmp, fator: f })}
                                 sub={o.width ? `${o.width * f}×${o.height * f}` : undefined} />
                  ))}
                </View>
              </Campo>
              <Opcao rotulo="Suavizar movimento" dica="Dobra os fps interpolando quadros." valor={cfgAmp.suavizar}
                     onMuda={(v) => setCfgAmp({ ...cfgAmp, suavizar: v })} />
              <Botao primario altura={48} rotulo={`Ampliar ${cfgAmp.fator}×`} icone={<Expandir size={16} color={c.accentFg} />}
                     onPress={() => { setAmpliar(false); onFechaEAcao(`/imagens/${mid}/ampliar`, { path: img.path, ...cfgAmp }); }} />
            </>
          )}
        </Folha>
      </View>
    </Modal>
  );
}
