import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, StatusBar, View, useWindowDimensions } from "react-native";
import { Text, TextInput } from "./Texto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, enviaArquivo, lerAjustes, type Msg, salvaAjustes, urlImagem } from "./api";
import type { Conv } from "./Chat";
import { pergunta } from "./Dialogo";
import { ArrowLeft, ArrowUp, Check, Clock, Cube, Download, Edit, Expandir, ExternalLink, Folder, Gauge, Paperclip, Refresh, Repetir, Sliders,
         Seta, Square, Voltar, X } from "./icones";
import { ArquivosPC, CampoMelhorar, encaixa, Formato, modeloMelhorar, razao } from "./Formato";
import { useGestos } from "./gestos";
import Mascara from "./Mascara";
import Liquido from "./Liquido";
import { restante, velocidade } from "./progresso";
import { GaleriaSite, TelaSlot, versoesPorSlot } from "./Slots";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Area, Botao, BotaoIcone, Caixa, Campo, CartaoOpcao, Chip, Contador, Deslizador, Folha, LinhaAjuste, Lista, Radio,
         Recolhivel, ResumoEstimativa, Selo, Seletor, num, toast } from "./ui";

// LoteImagem do backend (lotes.py / types.ts do desktop).
type Img = { path: string; seed: number; model_name?: string; status: string; progress?: number; fase?: string; preview?: string;
             com_previa?: boolean; restante?: number; s_passo?: number; error?: string; w?: number; h?: number; width?: number; height?: number;
             nome?: string; destino?: string; slot?: string; mid?: number; prompt?: string }; // slot do site (skill gerar-imagens)
type Slot = { nome: string; caminho: string; rel: string; prompt: string; prompt_base: string; estilo: string; largura: number | null; altura: number | null };
// GET /imagens/{conv}/origem: a conversa que a IA abriu para as imagens de um site (desktop ImagensView Origem).
type Origem = { message_id: number; workspace: string; projeto: string; chat: { id: number; title: string; kind: string } | null;
                slots: Slot[]; pendentes: Slot[]; fora_do_codigo: string[]; estilo: string; web: boolean };
type Lote = { user?: Msg; msg: Msg; imgs: Img[] };
type ModeloImg = { path: string; name: string; size?: number; req?: { nome?: string } | null; params?: Record<string, any> };
type LocalImg = { image: Record<string, any>; image_models: ModeloImg[]; runtimes: any; hardware?: { vram?: number }; image_dir?: string };
const GB = 2 ** 30;
type Opts = { steps: number; cfg: number; width: number; height: number; sampler: string; negative: string;
  hires?: boolean; hires_scale?: number; hires_denoise?: number; hires_upscaler?: string; out_dir?: string }; // alta resolução (hires fix do sd-cli), como no PC
type Ajustes = { models: string[]; count: number; seed: number; seed_mode: string; opts: Opts };
// Ampliar: uma imagem de um lote (mid = mensagem dele) ou uma do celular (já enviada ao PC, sem mid).
type Ampliar = { path: string; mid?: number; w?: number; h?: number; prompt?: string }; // prompt: o que gerou a imagem
// GET /local/video/ampliadores: os modelos no PC. tipo esrgan (rápido) ou seedvr2 (difusão, pelo ComfyUI do PC, minutos)
type Ampliadores = { no_disco: { path: string; name: string; tipo?: "esrgan" | "seedvr2" | "spandrel" | "redesenhar"; motor?: "comfy" | "sd" }[];
  comfy?: { instalado: string } };

// Listas do desktop (ImagensView / LocalPanel).
export const AMOSTRADORES = ["euler_a", "euler", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2mv2", "ipndm", "lcm", "ddim_trailing", "tcd",
  "res_multistep", "er_sde", "dpm++2m_sde", "lms"];
// Formato do desktop (FORMAS_IMAGEM): a de retrato sai do girar; o tamanho é o lado menor, em múltiplos de 64.
const FORMAS = ["1:1", "3:2", "16:9"];
const QUALS = ["512", "768", "1024", "1536"];
function tamanhoImagem(f: string, q: string): [number, number] {
  const [a, b] = f.split(":").map(Number), n = Number(q), r = a / b;
  return r >= 1 ? [encaixa(n * r, 64), n] : [n, encaixa(n / r, 64)];
}
const SEMENTES = [{ id: "incremental", rotulo: "Incremental" }, { id: "aleatoria", rotulo: "Aleatória" }, { id: "fixa", rotulo: "Fixa" }];
const PREDEFS = [{ id: "rapido", nome: "Rápido", steps: 12, cfg: 5, hires: 0, sub: "12 passos" },
  { id: "equilibrado", nome: "Equilibrado", steps: 20, cfg: 7, hires: 0, sub: "20 passos" },
  { id: "qualidade", nome: "Qualidade", steps: 30, cfg: 7, hires: 1.5, sub: "30 passos · hires" }];
const hiresDe = (o: Opts) => (o.hires ? o.hires_scale ?? 1.5 : 0);
const predefDe = (o: Opts) => PREDEFS.find((p) => p.steps === o.steps && p.cfg === o.cfg && p.hires === hiresDe(o));

// ponytail: fórmula provisória do handoff; trocar por tempos_imagem medidos quando o backend expuser (como tempos_video).
const S_PASSO_PADRAO = 0.55; // s por passo a 1 MP, sem medição do modelo nesta conversa
function estimaImagem(o: Opts, sPasso: number | null, gbModelo: number) {
  const px = (o.width * o.height) / 1048576;
  const hs = hiresDe(o);
  const porImagem = 2 + (sPasso ?? S_PASSO_PADRAO) * o.steps * px * (hs ? 1 + hs * hs * (o.hires_denoise ?? 0.45) * 1.4 : 1);
  return { s: porImagem, vram: gbModelo + 0.9 * px * (hs ? hs * hs : 1) };
}
export const tempoFmt = (sg: number) => (sg < 90 ? `${Math.round(sg)} s` : `${Math.round(sg / 60)} min`);
const MAX_REFS = 10;
const REFAZIVEIS = ["interrompida", "pendente", "cancelada", "erro"];
const ROTULO: Record<string, string> = { pendente: "na fila", gerando: "gerando", erro: "erro", cancelada: "cancelada",
  interrompida: "interrompida", descartada: "descartada", mantida: "mantida", pronta: "" };
// O desktop tira do opts o que é do modelo (IA local › Modelos): mandar o global por cima desligava a prévia ao vivo.
const DO_MODELO = ["model", "seed", "offload", "flash_attn", "vae_tiling", "te_cpu", "preview", "taesd"];

export type Destino = "galeria" | "pasta" | "compartilhar";

/** Baixa do PC para o cache do app (o MediaLibrary, o seletor de pasta e o compartilhar leem de um file:// local). */
async function baixaLocal(p: string): Promise<File> {
  const pasta = new Directory(Paths.cache, "baixadas");
  if (!pasta.exists) pasta.create();
  const nome = p.split(/[\\/]/).pop() || `forja-${Date.now()}.png`;
  return File.downloadFileAsync(urlImagem(p), new File(pasta, nome), { idempotent: true });
}

/** Salva imagens do PC no celular: galeria, uma pasta escolhida (seletor do Android) ou compartilhar. Devolve o aviso.
 * Galeria sem álbum: o Album.create(..., mover) levava o arquivo para Pictures/Forja sem registrar no MediaStore,
 * e a galeria (que lê o MediaStore) não mostrava nada. */
export async function salva(paths: string[], destino: Destino, mime = "image/png"): Promise<string> {
  const video = mime.startsWith("video");
  if (destino === "compartilhar") {
    const arq = await baixaLocal(paths[0]);
    await Sharing.shareAsync(arq.uri, { mimeType: mime, dialogTitle: "Compartilhar" });
    return "";
  }
  if (destino === "pasta") {
    const dir = await Directory.pickDirectoryAsync(); // cancelar rejeita: quem chama trata como "não salvou"
    for (const p of paths) {
      const arq = await baixaLocal(p);
      dir.createFile(arq.name, mime).write(await arq.bytes());
      arq.delete();
    }
    return `${paths.length === 1 ? (video ? "O vídeo foi salvo" : "A imagem foi salva") : `${paths.length} ${video ? "vídeos foram salvos" : "imagens foram salvas"}`} na pasta escolhida.`;
  }
  const perm = await requestPermissionsAsync(true, ["photo"]); // só escrita: não pede para ler a galeria
  if (!perm.granted) throw new Error("Sem permissão para salvar na galeria. Libere em Configurações do Android › Apps › Forja.");
  for (const p of paths) {
    const arq = await baixaLocal(p);
    await Asset.create(arq.uri);
    arq.delete();
  }
  return `${paths.length === 1 ? (video ? "O vídeo foi salvo" : "A imagem foi salva") : `${paths.length} ${video ? "vídeos foram salvos" : "imagens foram salvas"}`} na galeria (pasta DCIM, junto das fotos da câmera).`;
}

/** Imagens (stable-diffusion.cpp local): lotes da conversa + caixa de prompt com os ajustes do desktop. */
export default function Imagens({ conv, onCriada, onTurno, onAbreChat }:
  { conv: Conv | null; onCriada: (c: Conv) => void; onTurno: () => void; onAbreChat?: (c: Conv, kind: string) => void }) {
  const [convId, setConvId] = useState<number | null>(conv?.id ?? null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [local, setLocal] = useState<LocalImg | null>(null);
  const [aj, setAj] = useState<Ajustes | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [erro, setErro] = useState("");
  const [folha, setFolha] = useState(false);
  const [melhorando, setMelhorando] = useState(false);
  const [ver, setVer] = useState<Img | null>(null);
  const [salvar, setSalvar] = useState<string[] | null>(null); // imagens esperando o destino (galeria/pasta/compartilhar)
  const [origem, setOrigem] = useState<Origem | null>(null);
  const [estilo, setEstilo] = useState<string | null>(null); // folha "Outro estilo" aberta com o texto
  const [slotAberto, setSlotAberto] = useState<string | null>(null); // tela de versões de um slot do site
  const [ampliar, setAmpliar] = useState<Ampliar | null>(null);
  const [pintar, setPintar] = useState<{ path: string; w: number; h: number } | null>(null); // editor de máscara aberto
  const [esrgans, setEsrgans] = useState<Ampliadores["no_disco"]>([]); // ampliadores ESRGAN do PC para a alta resolução
  const [pintura, setPintura] = useState<{ uri: string; modo: "mascara" | "anotacao"; tracos: number; original: string } | null>(null);
  const lista = useRef<FlatList>(null);
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();

  // Pelo ref: quem chama depois de criar a conversa (gerar, repetir com confirm) é um closure com o convId antigo.
  const convRef = useRef(convId);
  convRef.current = convId;
  const carrega = useCallback(async () => {
    const convId = convRef.current;
    if (convId == null) return;
    try {
      const [conversa, o] = await Promise.all([api.get<{ messages: Msg[] }>(`/conversations/${convId}`),
        api.get<{ origem: Origem | null }>(`/imagens/${convId}/origem`).catch(() => ({ origem: null }))]);
      setMsgs(conversa.messages);
      setOrigem(o.origem);
    } catch (e: any) { setErro(e.message); }
  }, [convId]);

  useEffect(() => {
    carrega();
    api.get<LocalImg>("/local").then(async (l) => {
      setLocal(l);
      const im = l.image ?? {};
      const padrao: Ajustes = { models: [im.model ?? l.image_models[0]?.path].filter(Boolean), count: 4, seed: im.seed ?? 0, seed_mode: "incremental",
        opts: { steps: im.steps ?? 20, cfg: im.cfg ?? 7, width: im.width ?? 512, height: im.height ?? 512, sampler: im.sampler ?? "euler_a", negative: im.negative ?? "" } };
      const salvo = await lerAjustes<Ajustes>("imagem", padrao);
      // Modelo que sumiu do disco não fica marcado.
      salvo.models = salvo.models.filter((p) => l.image_models.some((m) => m.path === p));
      if (!salvo.models.length) salvo.models = padrao.models;
      setAj(salvo);
    }).catch((e) => setErro(e.message));
  }, [carrega]);

  useEffect(() => { if (folha && aj?.opts.hires) api.get<Ampliadores>("/local/video/ampliadores").then((r) => setEsrgans(r.no_disco.filter((x) => x.tipo === "esrgan"))).catch(() => {}); }, [folha, aj?.opts.hires]);
  const muda = (x: Partial<Ajustes>) => setAj((a) => { const n = { ...(a as Ajustes), ...x }; salvaAjustes("imagem", n); return n; });
  const mudaOpts = (x: Partial<Opts>) => aj && muda({ opts: { ...aj.opts, ...x } });

  const lotes = useMemo<Lote[]>(() => {
    const out: Lote[] = [];
    msgs.forEach((m, i) => {
      if (m.meta?.images) out.push({ user: msgs[i - 1]?.role === "user" ? msgs[i - 1] : undefined, msg: m,
                                     imgs: m.meta.images.map((x: Img) => ({ ...x, mid: m.id })) });
    });
    // Lote de slots que falhou inteiro e cujos slots já saíram em outro lote é sobra (como no desktop).
    const falhou = (x: Img) => ["cancelada", "erro", "interrompida"].includes(x.status);
    const saiu = new Set(out.flatMap((l) => l.imgs.filter((x) => !falhou(x)).map((x) => x.destino ?? x.slot)).filter(Boolean));
    return out.filter((l) => !l.imgs.every((x) => falhou(x) && saiu.has(x.destino ?? x.slot)));
  }, [msgs]);
  const rodando = lotes.some((l) => l.msg.status === "running");
  const versoes = useMemo(() => versoesPorSlot(lotes), [lotes]);
  const rodava = useRef(false);
  useEffect(() => { if (rodava.current && !rodando) onTurno(); rodava.current = rodando; }, [rodando]);
  // Enquanto algum lote roda, o desktop também consulta a conversa a cada 1,5 s (não há SSE de imagem).
  useEffect(() => {
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

  /** Pedido que o backend recusa com 409 quando há modelo de texto na VRAM: pergunta e repete com confirm. */
  async function comVram(faz: (confirm: boolean) => Promise<unknown>, oQue: string) {
    try { await faz(false); } catch (e: any) {
      if (e.status === 409)
        return pergunta("VRAM ocupada", `${e.message}\n\nDescarregar o modelo de texto e ${oQue}?`,
          [{ texto: "Cancelar", estilo: "cancelar" }, { texto: `Descarregar e ${oQue}`, acao: () => faz(true).then(carrega).catch((er) => setErro(er.message)) }]);
      setErro(e.message);
    }
  }

  async function garanteConv(): Promise<number | null> {
    if (convRef.current != null) return convRef.current;
    try {
      const nova = await api.post<Conv>("/conversations", { kind: "imagem" });
      onCriada(nova);
      convRef.current = nova.id;
      setConvId(nova.id);
      return nova.id;
    } catch (e: any) { setErro(e.message); return null; }
  }

  /** Uma imagem do celular: vai para o PC (pasta de referências) e abre a folha de ampliar. */
  async function ampliaDoCelular() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["image/png", "image/jpeg", "image/webp"], copyToCacheDirectory: true }).catch(() => null);
    if (!r || r.canceled) return;
    const a = r.assets[0];
    try {
      const { path } = await enviaArquivo<{ path: string }>("/imagens/referencia", { uri: a.uri, name: a.name, mimeType: a.mimeType });
      setAmpliar({ path });
    } catch (e: any) { setErro(e.message); }
  }

  async function amplia(fator: number, modelo: string, extra: { prompt?: string; forca?: number } = {}) {
    const alvo = ampliar;
    if (!alvo) return;
    setAmpliar(null);
    setErro("");
    // SeedVR2 com modelo de texto na VRAM: o PC responde 409 e a pergunta é a mesma do gerar
    const id = alvo.mid != null ? null : await garanteConv();
    if (alvo.mid == null && id == null) return;
    await comVram(async (confirm) => {
      if (alvo.mid != null) await api.post(`/imagens/${alvo.mid}/ampliar`, { path: alvo.path, fator, modelo, confirm, ...extra });
      else await api.post(`/imagens/${id}/ampliar-arquivo`, { path: alvo.path, fator, modelo, confirm, ...extra });
      carrega();
    }, "ampliar");
  }

  async function gera(textoPronto?: string, refsProntas?: string[]) {
    const texto = (textoPronto ?? prompt).trim();
    const refsUsadas = refsProntas ?? refs;
    if (!texto || !aj?.models.length || !local) return;
    setErro("");
    const opts = Object.fromEntries(Object.entries({ ...local.image, ...aj.opts }).filter(([k]) => !DO_MODELO.includes(k)));
    // A conversa sai antes do comVram: o repetir com confirm é outro closure, com o convId ainda null,
    // e criava uma segunda conversa (o lote rodava nela, a tela ficava na vazia).
    const id = await garanteConv();
    if (id == null) return;
    await comVram(async (confirm) => {
      // Como o desktop: o que está na tela também vira o padrão da ferramenta image_generate do agente.
      await api.put("/local/image/defaults", { ...local.image, ...aj.opts, model: aj.models[0] });
      await api.post(`/imagens/${id}/gerar`, { prompt: texto, opts, models: aj.models, count: aj.count, seed: aj.seed,
        seed_mode: aj.seed_mode, confirm, refs: refsUsadas });
      setPrompt("");
      carrega();
    }, "gerar");
  }

  /** Fila dos slots, regerar um slot ou todas com outro estilo: prompt, tamanho e arquivo vêm do backend. */
  function gerarDoBackend(extra: { slots_de: number } | { variar: { message_id: number; path: string; prompt?: string }; count: number } | { estilo: string; count: number }) {
    if (!aj?.models.length || !local || convId == null) return setFolha(true);
    setErro("");
    const opts = Object.fromEntries(Object.entries({ ...local.image, ...aj.opts })
      .filter(([k]) => !DO_MODELO.includes(k) && k !== "width" && k !== "height"));
    return comVram(async (confirm) => {
      await api.put("/local/image/defaults", { ...local.image, ...aj.opts, model: aj.models[0] });
      await api.post(`/imagens/${convId}/gerar`, { opts, models: aj.models, seed: aj.seed, seed_mode: aj.seed_mode, confirm, ...extra });
      setVer(null);
      carrega();
    }, "gerar");
  }

  async function otimizar() {
    try {
      const r = await api.post<{ imagens: { png: number; webp: number }[] }>(`/imagens/${convId}/otimizar`, {}, 120000);
      const kb = (n: number) => Math.round(n / 1024);
      pergunta("Versão web", `${r.imagens.length} imagens em .webp: ${kb(r.imagens.reduce((t, i) => t + i.png, 0))} KB → ` +
        `${kb(r.imagens.reduce((t, i) => t + i.webp, 0))} KB. O código do site agora aponta para os .webp.`, [{ texto: "Ok" }]);
      carrega();
    } catch (e: any) { setErro(e.message); }
  }

  async function melhora() {
    const texto = prompt.trim();
    if (!texto) return;
    setMelhorando(true);
    try {
      const d = await modeloMelhorar("imagem");
      if (!d.model) throw new Error("Escolha um modelo de texto no Chat antes.");
      setPrompt((await api.post<{ prompt: string }>("/imagens/prompt", { prompt: texto, provider: d.provider, model: d.model }, 180000)).prompt);
    } catch (e: any) { setErro(e.message); }
    setMelhorando(false);
  }

  async function anexaRef() {
    if (refs.length >= MAX_REFS) return setErro(`No máximo ${MAX_REFS} referências.`);
    const r = await DocumentPicker.getDocumentAsync({ type: "image/*", multiple: true, copyToCacheDirectory: true }).catch(() => null);
    if (!r || r.canceled) return;
    for (const a of r.assets.slice(0, MAX_REFS - refs.length)) {
      try {
        const { path } = await enviaArquivo<{ path: string }>("/imagens/referencia", { uri: a.uri, name: a.name, mimeType: a.mimeType });
        setRefs((x) => [...x, path]);
      } catch (e: any) { setErro(e.message); }
    }
  }

  /** Reaproveitar: prompt, opções, modelos, quantidade, sementes e referências do pedido daquele lote. */
  const reaproveita = (l: Lote) => {
    const m = l.user?.meta ?? {};
    setPrompt(l.user?.content ?? "");
    if (aj) muda({ models: m.models ?? aj.models, count: m.count ?? aj.count, seed_mode: m.seed_mode ?? aj.seed_mode,
      seed: m.seed ?? aj.seed, opts: { ...aj.opts, ...Object.fromEntries(Object.entries(m.opts ?? {}).filter(([k]) => k in aj.opts)) } });
    setRefs(m.refs ?? []);
  };

  const acao = (path: string, body?: unknown) => api.post(path, body).then(carrega).catch((e) => setErro(e.message));
  /** Mais versões de um slot a partir da que está no site (prompt editado ou o mesmo dela), como o desktop. */
  function regerarSlot(slot: string, prompt?: string) {
    const todas = versoes.get(slot) ?? [];
    const base = todas.find((v) => v.img.destino) ?? todas[0];
    if (base) gerarDoBackend({ variar: { message_id: base.img.mid ?? base.lote.id, path: base.img.path, ...(prompt ? { prompt } : {}) },
                               count: aj?.count ?? 1 });
  }
  const baixa = async (paths: string[]) => setSalvar(paths);
  async function paraDestino(destino: Destino) {
    const paths = salvar ?? [];
    setSalvar(null);
    try {
      const aviso = await salva(paths, destino);
      if (aviso) toast(aviso);
    } catch (e: any) {
      if (!/cancel/i.test(String(e?.message))) setErro(e.message); // cancelar o seletor de pasta não é erro
    }
  }

  /** Máscara ou anotação pronta (Editor de máscara): sobe o PNG como referência, como o usarPintura do desktop. */
  async function usaPintura(texto: string) {
    const p = pintura;
    if (!p) return;
    setPintura(null);
    try {
      const { path } = await enviaArquivo<{ path: string }>("/imagens/referencia", { uri: p.uri, name: `${p.modo}.png`, mimeType: "image/png" });
      const novas = p.modo === "mascara" ? [p.original, path] : [path];
      setRefs(novas);
      setPrompt(texto);
      gera(texto, novas);
    } catch (e: any) { setErro(e.message); }
  }

  const modelos = aj?.models.map((p) => local?.image_models.find((m) => m.path === p)).filter(Boolean) as ModeloImg[] ?? [];
  const nomes = modelos.map((m) => m.name);
  // s/passo medido nesta conversa (as imagens prontas trazem o s_passo); sem medição, o padrão da fórmula
  const medidos = lotes.flatMap((l) => l.imgs).filter((i) => i.s_passo && nomes.includes(i.model_name ?? "")).map((i) => i.s_passo!);
  const sPasso = medidos.length ? medidos.reduce((a, b) => a + b, 0) / medidos.length : null;
  const gbModelo = Math.max(0, ...modelos.map((m) => (m.size ?? 0) / GB));
  const gpu = local?.hardware?.vram ? local.hardware.vram / GB : null;
  const est = aj ? estimaImagem(aj.opts, sPasso, gbModelo) : null;
  const passa = !!est && gpu != null && est.vram > gpu;
  const predef = aj ? predefDe(aj.opts) : undefined;
  const nomeTam = (o: Opts) => razao(o.width, o.height).join(":");
  // Tamanho acima de 1,5× o nativo dos modelos marcados fica apagado (ainda clicável), como no desktop.
  const nativo = Math.max(0, ...modelos.map((m) => Math.min(m.params?.width ?? 0, m.params?.height ?? 0)));
  const resumo = aj ? `${predef?.nome ?? "Personalizado"} · ${nomeTam(aj.opts)} · ×${aj.count}` : "Ajustes";
  const rotModelo = nomes.length > 1 ? `${nomes.length} modelos` : nomes[0] ?? "Modelo";

  return (
    <View style={{ flex: 1, paddingBottom: teclado }}>
      <FlatList
        ref={lista}
        data={origem ? [] : lotes}
        keyExtractor={(l) => String(l.msg.id)}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: 12, gap: 18, flexGrow: lotes.length ? 0 : 1 }}
        ListHeaderComponent={origem ? (
          <CartaoOrigem origem={origem} temImagens={lotes.length > 0} ocupado={rodando} modelos={nomes}
                        onChat={() => origem.chat && onAbreChat?.({ id: origem.chat.id, title: origem.chat.title }, origem.chat.kind)}
                        onGerar={() => gerarDoBackend({ slots_de: origem.message_id })} onAjustes={() => setFolha(true)}
                        onEstilo={() => setEstilo(origem.estilo)} onOtimizar={otimizar}>
            <GaleriaSite slots={origem.slots} versoes={versoes} fora={new Set(origem.fora_do_codigo)} onAbrir={setSlotAberto} />
          </CartaoOrigem>
        ) : null}
        ListEmptyComponent={origem ? null :
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 }}>
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: "600" }}>O que vamos criar?</Text>
            <Text style={[s.muted, { textAlign: "center" }]}>
              {local && !local.runtimes?.sd?.installed ? "Instale o stable-diffusion.cpp em IA local no desktop." : "Descreva a imagem. Ela é gerada no PC, com o modelo local."}
            </Text>
            {aj && !!nomes.length && (
              <Pressable onPress={() => setFolha(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: c.line,
                                                                 borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginTop: 4 }}>
                <Cube size={13} color={c.faint} />
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }} numberOfLines={1}>
                  {rotModelo} · {aj.opts.width}×{aj.opts.height}{est ? ` · ~${tempoFmt(est.s)}` : ""}
                </Text>
              </Pressable>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <LoteView lote={item} onVer={setVer} onAcao={acao} onReaproveita={() => reaproveita(item)} onBaixar={baixa}
                    onContinua={() => comVram((confirm) => api.post(`/imagens/${item.msg.id}/continuar`, { confirm }).then(carrega), "continuar")} />
        )}
      />
      {!!erro && <Text style={[s.muted, { color: c.err, paddingHorizontal: 14 }]} onPress={() => setErro("")}>{erro}</Text>}
      {origem ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(inset.bottom, 10) }}>
          <Text style={[s.faint, { flex: 1, fontSize: 12 }]}>Toque numa imagem para ver as versões, regerar ou trocar a do site.</Text>
          <Chip rotulo={rotModelo} icone={<Cube size={14} color={c.muted} />} onPress={() => setFolha(true)} />
          <Chip rotulo={`×${aj?.count ?? 1}`} onPress={() => setFolha(true)} />
        </View>
      ) : (
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          {refs.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4, paddingTop: 4 }}>
              {refs.map((r) => <Miniatura key={r} uri={urlImagem(r)} onTira={() => setRefs((x) => x.filter((y) => y !== r))} />)}
            </ScrollView>
          )}
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={prompt}
                     onChangeText={setPrompt} multiline placeholder={refs.length ? "O que mudar nas referências" : "Descreva a imagem"}
                     placeholderTextColor={c.faint} />
          {!!est && (
            <LinhaEstimativa onPress={() => setFolha(true)} passa={passa}
                             tempo={`~${tempoFmt(est.s)} cada${(aj?.count ?? 1) > 1 ? ` · ~${tempoFmt(est.s * aj!.count)} as ${aj!.count}` : ""}`}
                             vram={`${num(est.vram, 1)} GB de VRAM`} />
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={refs.length ? String(refs.length) : undefined} icone={<Paperclip size={15} color={c.muted} />} onPress={anexaRef} />
              <Chip rotulo={rotModelo} icone={<Cube size={14} color={c.muted} />} onPress={() => setFolha(true)} />
              <Chip rotulo={resumo} icone={<Sliders size={14} color={c.muted} />} onPress={() => setFolha(true)} />
              <Chip rotulo={melhorando ? "Melhorando…" : "Melhorar"} icone={<Edit size={14} color={c.muted} />} onPress={melhora} />
              <Chip rotulo="Ampliar" icone={<Expandir size={14} color={c.muted} />} onPress={ampliaDoCelular} />
            </ScrollView>
            <BotaoEnviar pode={!!prompt.trim() && !!aj?.models.length} onPress={() => gera()} />
          </View>
        </View>
      </View>
      )}

      <Folha aberta={estilo != null} titulo="Outro estilo para as imagens do site" onFecha={() => setEstilo(null)}>
        <Text style={s.muted}>Vai no fim do prompt de cada imagem, no lugar do estilo atual. Saem {aj?.count ?? 1} versão(ões) de cada; o site só muda quando você escolher.</Text>
        <TextInput style={[s.input, { minHeight: 80 }]} value={estilo ?? ""} onChangeText={setEstilo} multiline
                   placeholder="cold blue night light, film grain, minimal" placeholderTextColor={c.faint} />
        <Pressable style={s.btn} onPress={() => { const e = (estilo ?? "").trim(); setEstilo(null); gerarDoBackend({ estilo: e, count: aj?.count ?? 1 }); }}>
          <Text style={s.btnTxt}>Gerar as versões</Text>
        </Pressable>
      </Folha>

      {aj && local && (
        <Folha aberta={folha} titulo="Ajustes da geração" onFecha={() => setFolha(false)}
               fixo={<ResumoEstimativa gpu={gpu} vram={est?.vram ?? null} tempo={est ? `~${tempoFmt(est.s)} cada${aj.count > 1 ? ` · ~${tempoFmt(est.s * aj.count)} as ${aj.count}` : ""}` : null}
                                       linha={`${aj.count} × ${aj.opts.width}×${aj.opts.height} · ${aj.opts.steps} passos · ${aj.opts.sampler}${aj.opts.hires ? ` · hires ${num(aj.opts.hires_scale ?? 1.5)}×` : ""}`}
                                       estouro="Passa da VRAM da GPU: o sd.cpp divide com a RAM e fica bem mais lento." />}>
          <Campo rotulo="Predefinição" dica={predef ? undefined : "Personalizado: os valores de Avançado não batem com nenhuma predefinição."}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {PREDEFS.map((p) => {
                const o = { ...aj.opts, steps: p.steps, cfg: p.cfg, hires: p.hires > 0, hires_scale: p.hires || aj.opts.hires_scale };
                return <CartaoOpcao key={p.id} titulo={p.nome} sub={p.sub} extra={`~${tempoFmt(estimaImagem(o, sPasso, gbModelo).s)}`}
                                    on={predef?.id === p.id} onPress={() => mudaOpts({ steps: p.steps, cfg: p.cfg, hires: p.hires > 0,
                                                                                         ...(p.hires ? { hires_scale: p.hires } : {}) })} />;
              })}
            </View>
          </Campo>
          <Campo rotulo="Modelos" dica="Com mais de um, as variações se dividem entre eles.">
            <View>
              {local.image_models.map((m) => {
                const on = aj.models.includes(m.path);
                return (
                  <Caixa key={m.path} rotulo={m.name} on={on} sub={[m.req?.nome, m.size ? `${num(m.size / GB, 1)} GB` : ""].filter(Boolean).join(" · ")}
                         onPress={() => {
                           // Marcar um modelo traz os parâmetros dele (passos, cfg, tamanho, amostrador), como no desktop.
                           const models = on ? aj.models.filter((p) => p !== m.path) : [...aj.models, m.path];
                           const pr = !on && m.params ? Object.fromEntries(Object.entries(m.params).filter(([k]) => k in aj.opts)) : {};
                           muda({ models, opts: { ...aj.opts, ...pr } });
                         }} />
                );
              })}
            </View>
          </Campo>
          <Formato formas={FORMAS} quals={QUALS.map((q) => ({ id: q, off: nativo > 0 && Number(q) > nativo * 1.5 }))} tamanhoPara={tamanhoImagem}
                   w={aj.opts.width} h={aj.opts.height} mult={64} onMuda={(w, h) => mudaOpts({ width: w, height: h })}
                   dicaQual="Bem acima do tamanho nativo do modelo: pesa na memória e costuma repetir elementos na imagem." />
          <LinhaAjuste rotulo="Variações" sub="Imagens por pedido">
            <Contador valor={aj.count} min={1} max={50} onMuda={(n) => muda({ count: n })} />
          </LinhaAjuste>
          <Campo rotulo="Negativo">
            <Area valor={aj.opts.negative} onMuda={(t) => mudaOpts({ negative: t })} placeholder="O que evitar na imagem" />
          </Campo>
          <Recolhivel titulo="Avançado" sub={`${aj.opts.steps} passos · CFG ${num(aj.opts.cfg)} · ${aj.opts.sampler} · ${SEMENTES.find((x) => x.id === aj.seed_mode)?.rotulo.toLowerCase()}`}>
            <Deslizador rotulo="Passos" valor={aj.opts.steps} min={1} max={60} onMuda={(n) => mudaOpts({ steps: n })} />
            <Deslizador rotulo="CFG" valor={aj.opts.cfg} min={0} max={15} passo={0.5} onMuda={(n) => mudaOpts({ cfg: n })}
                        dica="Quanto o modelo segue o prompt. FLUX e LCM pedem 1." />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Campo rotulo="Largura">
                <Contador caixa valor={aj.opts.width} min={256} max={2048} passo={64} onMuda={(n) => mudaOpts({ width: n })} />
              </Campo></View>
              <View style={{ flex: 1 }}><Campo rotulo="Altura">
                <Contador caixa valor={aj.opts.height} min={256} max={2048} passo={64} onMuda={(n) => mudaOpts({ height: n })} />
              </Campo></View>
            </View>
            <Campo rotulo="Amostrador">
              <Seletor rolavel opcoes={AMOSTRADORES.map((a) => ({ id: a, rotulo: a }))} valor={aj.opts.sampler} onMuda={(v) => mudaOpts({ sampler: v })} />
            </Campo>
            <Campo rotulo="Alta resolução" dica="Gera, amplia e o próprio modelo redesenha por cima: mais detalhe, bem mais tempo.">
              <Seletor<"0" | "1.5" | "2"> cheio opcoes={[{ id: "0", rotulo: "Desligada" }, { id: "1.5", rotulo: "1,5×" }, { id: "2", rotulo: "2×" }]}
                       valor={aj.opts.hires ? (String(aj.opts.hires_scale ?? 1.5) as "1.5" | "2") : "0"}
                       onMuda={(v) => mudaOpts(v === "0" ? { hires: false } : { hires: true, hires_scale: Number(v) })} />
            </Campo>
            {aj.opts.hires && (
              <Deslizador rotulo="Denoise" valor={aj.opts.hires_denoise ?? 0.45} min={0.2} max={0.7} passo={0.05} casas={2}
                          onMuda={(n) => mudaOpts({ hires_denoise: n })} pontas={["mantém e limpa", "inventa detalhe"]} />
            )}
            {aj.opts.hires && (
              <Campo rotulo="Ampliador">
                <Seletor rolavel valor={aj.opts.hires_upscaler ?? local.image.hires_upscaler ?? "Lanczos"} onMuda={(v) => mudaOpts({ hires_upscaler: v })}
                         opcoes={[{ id: "Lanczos", rotulo: "Lanczos" }, { id: "Latent", rotulo: "Latente (pede denoise alto)" },
                                  ...esrgans.map((e) => ({ id: e.path, rotulo: e.name }))]} />
              </Campo>
            )}
            <Campo rotulo="Sementes">
              <Seletor cheio opcoes={SEMENTES} valor={aj.seed_mode} onMuda={(v) => muda({ seed_mode: v })} />
            </Campo>
            {aj.seed_mode !== "aleatoria" && <CampoSemente valor={aj.seed} onMuda={(n) => muda({ seed: n })} />}
          </Recolhivel>
          <CampoMelhorar aba="imagem" />
          <ArquivosPC pasta={aj.opts.out_dir ?? local.image.out_dir ?? ""} padrao={local.image_dir} onPasta={(p) => mudaOpts({ out_dir: p })}
                      dias={local.image.descarte_dias ?? 7} onDias={(n) => {
                        setLocal({ ...local, image: { ...local.image, descarte_dias: n } });
                        api.put("/local/image/defaults", { ...local.image, descarte_dias: n }).catch((e) => toast(e.message));
                      }} />
          <Botao rotulo="Salvar como padrão" icone={<Check size={14} color={c.fg} />} onPress={() =>
            api.put("/local/image/defaults", { ...local.image, ...aj.opts, model: aj.models[0] }).then(() => toast("Salvo como padrão no PC."))
              .catch((e) => toast(e.message))} />
        </Folha>
      )}

      <Folha aberta={!!salvar} titulo={salvar && salvar.length > 1 ? `Salvar ${salvar.length} imagens` : "Salvar imagem"} onFecha={() => setSalvar(null)}>
        <Lista<Destino> valor={"" as Destino} onEscolhe={paraDestino} opcoes={[
          { id: "galeria", rotulo: "Galeria", dica: "Aparece na galeria, junto das fotos da câmera (DCIM)", icone: <Download size={17} color={c.muted} /> },
          { id: "pasta", rotulo: "Escolher pasta…", dica: "Qualquer pasta do celular ou do cartão (seletor do Android)", icone: <Folder size={17} color={c.muted} /> },
          ...(salvar?.length === 1 ? [{ id: "compartilhar" as Destino, rotulo: "Compartilhar…", dica: "WhatsApp, Drive, e-mail ou outro app",
                                        icone: <ExternalLink size={17} color={c.muted} /> }] : []),
        ]} />
      </Folha>

      <TelaSlot slot={slotAberto} info={origem?.slots.find((x) => x.caminho === slotAberto)} itens={slotAberto ? versoes.get(slotAberto) ?? [] : []}
                count={aj?.count ?? 1} onCount={(n) => muda({ count: n })} ocupado={rodando || !!(local as any)?.image_busy}
                onEscolher={(path) => slotAberto && acao(`/imagens/${convId}/escolher`, { slot: slotAberto, path })}
                onRegerar={(p) => slotAberto && regerarSlot(slotAberto, p)}
                onParar={(ids) => Promise.all(ids.map((id) => api.post(`/imagens/${id}/cancelar`).catch(() => {}))).then(carrega)}
                onZoom={(img) => setVer(img as Img)} onFecha={() => setSlotAberto(null)} />

      <FolhaAmpliar key={ampliar?.path ?? ""} alvo={ampliar} onFecha={() => setAmpliar(null)} onAmpliar={amplia} onErro={setErro} />

      {(() => {
        const lote = lotes.find((l) => l.msg.id === ver?.mid);
        const doLote = (lote?.imgs ?? []).filter((i) => ["pronta", "mantida"].includes(i.status));
        return (
          <Visor img={ver} fila={doLote} onI={setVer} prompt={promptDaImagem(lote?.user)} detalhe={redesenhoDe(lote?.msg)} onFecha={() => setVer(null)} onBaixar={baixa}
                 onAmpliar={(i, w, h) => { setVer(null); setAmpliar({ path: i.path, mid: i.mid, w, h, prompt: promptDaImagem(lote?.user) }); }}
                 onEditar={origem ? undefined : (p) => { setRefs((x) => (x.includes(p) || x.length >= MAX_REFS ? x : [...x, p])); setVer(null); }}
                 onPintar={origem ? undefined : (i, w, h) => { setVer(null); setPintar({ path: i.path, w: w ?? 1024, h: h ?? 1024 }); }}
                 onSemente={origem ? undefined : (n) => { muda({ seed: n, seed_mode: "fixa" }); setVer(null); }}
                 onUsarNoSite={ver && chaveSlot(ver) && !ver.destino ? () => { const v = ver; setVer(null); acao(`/imagens/${convId}/escolher`, { slot: chaveSlot(v), path: v.path }); } : undefined} />
        );
      })()}

      <Mascara alvo={pintar} modelo={nomes[0]} onFecha={() => setPintar(null)}
               onPronta={(uri, modo, tracos) => { const p = pintar!; setPintar(null); setPintura({ uri, modo, tracos, original: p.path }); }} />
      <Folha aberta={!!pintura} titulo="O que mudar na área marcada" onFecha={() => setPintura(null)}>
        {pintura && <FolhaPintura p={pintura} count={aj?.count ?? 4} onGerar={usaPintura} />}
      </Folha>
    </View>
  );
}

/** Linha de estimativa do composer (Imagens e Vídeo): tempo e VRAM, âmbar quando passa da GPU. */
export function LinhaEstimativa({ tempo, vram, passa, onPress }: { tempo: string; vram: string; passa: boolean; onPress: () => void }) {
  const cor = passa ? c.warn : c.faint;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
        <Clock size={12} color={c.faint} />
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>{tempo}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Gauge size={12} color={cor} />
        <Text style={{ color: cor, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>{vram}</Text>
      </View>
    </Pressable>
  );
}

/** Enviar: círculo de 36 no acento; desabilitado em raised com o ícone apagado. */
export function BotaoEnviar({ pode, onPress }: { pode: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!pode} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
                                                           backgroundColor: pode ? c.accent : c.raised }}>
      <ArrowUp size={18} color={pode ? c.accentFg : c.faint} />
    </Pressable>
  );
}

/** Miniatura de referência (52×52) com o X de 18 no canto. */
export function Miniatura({ uri, onTira, lado = 52 }: { uri: string; onTira: () => void; lado?: number }) {
  return (
    <View>
      <Image source={{ uri }} style={{ width: lado, height: lado, borderRadius: 10, backgroundColor: c.raised }} />
      <Pressable onPress={onTira} hitSlop={8} style={{ position: "absolute", right: 3, top: 3, width: 18, height: 18, borderRadius: 9,
                                                       backgroundColor: "#0009", alignItems: "center", justifyContent: "center" }}>
        <X size={11} color="#fff" />
      </Pressable>
    </View>
  );
}

/** Semente base: número mono com Sortear ao lado. */
export function CampoSemente({ valor, onMuda }: { valor: number; onMuda: (n: number) => void }) {
  return (
    <Campo rotulo="Semente base" dica="0 = escolhe uma ao acaso.">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[s.input, { flex: 1, height: 44, fontFamily: mono, fontSize: 15, paddingVertical: 0 }]} keyboardType="number-pad"
                   value={String(valor)} onChangeText={(t) => { const n = Number(t.replace(/\D/g, "")); if (!Number.isNaN(n)) onMuda(Math.min(n, 2147483647)); }} />
        <Botao rotulo="Sortear" altura={44} icone={<Refresh size={14} color={c.fg} />} onPress={() => onMuda(Math.floor(Math.random() * 2147483647))} />
      </View>
    </Campo>
  );
}

/** Depois do editor de máscara: miniatura, o resumo e o que mudar; gera com a máscara como referência. */
function FolhaPintura({ p, count, onGerar }: { p: { uri: string; modo: "mascara" | "anotacao"; tracos: number }; count: number; onGerar: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Image source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: "#000" }} />
        <Text style={[s.muted, { flex: 1, lineHeight: 19 }]}>
          {p.modo === "mascara" ? `Máscara com ${p.tracos} traço${p.tracos === 1 ? "" : "s"}. A original vai inteira como primeira referência.`
                                : `Anotação com ${p.tracos} traço${p.tracos === 1 ? "" : "s"}. Ela entra no lugar da original.`}
        </Text>
      </View>
      <Area valor={t} onMuda={setT} linhas={3}
            placeholder={p.modo === "mascara" ? "ex.: replace with a steel anvil, same lighting" : "ex.: remove the watch in the red circle"} />
      <Botao primario altura={48} rotulo={count === 1 ? "Gerar 1 versão" : `Gerar ${count} versões`} icone={<ArrowUp size={16} color={c.accentFg} />} desabilitado={!t.trim()}
             onPress={() => onGerar(t.trim())} />
    </>
  );
}

/** O prompt que descreve a imagem de um lote (lotes.prompt_da_imagem do PC): o da geração; numa ampliação, o do
 *  redesenho dela; numa ampliação de arquivo, o pedido é o nome do arquivo e o prompt fica vazio. */
function promptDaImagem(pedido?: Msg): string {
  if (!pedido) return "";
  const amp = pedido.meta?.ampliacao as { prompt?: string } | undefined;
  if (!amp) return pedido.content ?? "";
  return amp.prompt || (/\.(png|jpe?g|webp)$/i.test(pedido.content ?? "") ? "" : pedido.content ?? "");
}

/** mosaico.ts do desktop: cada item vai para a coluna mais baixa até ali (proporções w/h). */
export function distribuir(proporcoes: number[], colunas = 2, rodape = 0): number[][] {
  const alturas = Array(colunas).fill(0);
  const cols: number[][] = Array.from({ length: colunas }, () => []);
  proporcoes.forEach((r, i) => {
    const k = alturas.indexOf(Math.min(...alturas));
    cols[k].push(i);
    alturas[k] += 1 / (r || 1) + rodape;
  });
  return cols;
}

/** Selo de check (22×22) no canto do tile escolhido. */
const SeloCheck = () => (
  <View style={{ position: "absolute", right: 8, top: 8, width: 22, height: 22, borderRadius: 6, backgroundColor: c.accent,
                 alignItems: "center", justifyContent: "center" }}>
    <Check size={14} color={c.accentFg} />
  </View>
);

function LoteView({ lote, onVer, onAcao, onReaproveita, onContinua, onBaixar }: {
  lote: Lote; onVer: (i: Img) => void; onAcao: (path: string, body?: unknown) => void; onReaproveita: () => void; onContinua: () => void;
  onBaixar: (paths: string[]) => Promise<void>;
}) {
  const [baixando, setBaixando] = useState(false);
  const { width } = useWindowDimensions();
  const [escolhendo, setEscolhendo] = useState(false);
  const [manter, setManter] = useState<string[]>([]);
  const lado = (width - 24 - 8) / 2;
  const rodando = lote.msg.status === "running";
  const prontas = lote.imgs.filter((i) => i.status === "pronta");
  const salvaveis = lote.imgs.filter((i) => ["pronta", "mantida"].includes(i.status));
  const refazer = lote.imgs.filter((i) => REFAZIVEIS.includes(i.status)).length;
  const o = (lote.msg.meta?.opts ?? {}) as Partial<Opts>;
  const razaoDe = (i: Img) => (i.w && i.h ? i.w / i.h : i.width && i.height ? i.width / i.height : o.width && o.height ? o.width / o.height : 1);
  const colunas = distribuir(lote.imgs.map(razaoDe), 2);
  const tags = [lote.imgs[0]?.model_name, o.width && `${o.width}×${o.height}`, o.steps && `${o.steps} passos`, o.sampler].filter(Boolean) as string[];

  const tile = (img: Img) => {
    // Prévia ao vivo: o sd-cli regrava o arquivo de prévia a cada passo; o &v= fura o cache da imagem.
    // ampliação em andamento: a original por trás, como no desktop
    const origem = lote.msg.meta?.opts?.ampliacao?.origem as string | undefined;
    const src = img.status === "gerando" && img.preview ? urlImagem(img.preview, String(img.progress ?? 0)) :
                ["pronta", "mantida"].includes(img.status) ? urlImagem(img.path) :
                ["gerando", "pendente"].includes(img.status) && origem ? urlImagem(origem) : null;
    const marcada = manter.includes(img.path);
    return (
      <Pressable key={img.path + img.seed} style={{ width: "100%", aspectRatio: razaoDe(img), borderRadius: 14, overflow: "hidden",
                   backgroundColor: c.surface, borderColor: marcada ? c.accent : c.line, borderWidth: marcada ? 2 : 1 }}
                 onPress={() => (escolhendo && img.status === "pronta"
                   ? setManter((m) => (marcada ? m.filter((p) => p !== img.path) : [...m, img.path]))
                   : ["pronta", "mantida"].includes(img.status) && onVer(img))}>
        {src ? <Image source={{ uri: src }} style={{ flex: 1 }} resizeMode="cover" fadeDuration={0} /> : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            {img.status === "pendente" ? <ActivityIndicator color={c.muted} /> : null}
          </View>
        )}
        {/* sem prévia ao vivo (ampliação, modelo sem modo de prévia): o líquido do desktop sobe com o progresso */}
        {img.status === "gerando" && !img.preview && <Liquido fracao={img.progress ?? 0} largura={lado} />}
        {marcada && <SeloCheck />}
        {!!img.nome && img.status === "pronta" && !rodando && (
          <Text style={{ position: "absolute", left: 6, bottom: 6, color: "#fff", fontSize: 11, fontFamily: mono, backgroundColor: "#000a",
                         borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }} numberOfLines={1}>{img.destino ? "● " : ""}{img.nome}</Text>
        )}
        {(img.status !== "pronta" || rodando) && !!ROTULO[img.status] && (
          <View style={{ position: "absolute", left: 6, bottom: 6, right: 6, backgroundColor: "#000b", borderRadius: 8, padding: 6 }}>
            <Text style={{ color: img.status === "erro" ? c.err : img.status === "mantida" ? c.ok : c.fg, fontSize: 12 }} numberOfLines={2}>
              {(img.status === "gerando" && img.fase) || ROTULO[img.status]}{img.status === "gerando" && img.progress != null ? ` ${Math.round(img.progress * 100)}%` : ""}
              {img.status === "gerando" && img.s_passo ? ` · ${velocidade(img.s_passo)}` : ""}
              {img.status === "gerando" && img.restante ? ` · ${restante(img.restante)}` : ""}{img.error ? ` · ${img.error}` : ""}
            </Text>
            {img.status === "gerando" && (
              <View style={{ height: 3, backgroundColor: c.line, borderRadius: 2, marginTop: 4 }}>
                <View style={{ height: 3, width: `${Math.round((img.progress ?? 0) * 100)}%`, backgroundColor: c.accent, borderRadius: 2 }} />
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 10 }}>
      {!!lote.user?.content && (
        <View style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: c.raised, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={s.txt} selectable>{lote.user.content}</Text>
        </View>
      )}
      {tags.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {tags.map((t) => (
            <Text key={t} style={{ color: c.faint, fontFamily: mono, fontSize: 11.5, backgroundColor: c.raised, borderRadius: 5,
                                   paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" }}>{t}</Text>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        {colunas.map((col, k) => <View key={k} style={{ flex: 1, gap: 8 }}>{col.map((i) => tile(lote.imgs[i]))}</View>)}
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {rodando && <Botao rotulo="Cancelar lote" icone={<Square size={12} color={c.fg} />} onPress={() => onAcao(`/imagens/${lote.msg.id}/cancelar`)} />}
        {!rodando && refazer > 0 && <Botao rotulo={`Continuar (${refazer})`} icone={<Refresh size={14} color={c.fg} />} onPress={onContinua} />}
        {!rodando && !escolhendo && <Botao rotulo="Reaproveitar" icone={<Refresh size={14} color={c.fg} />} onPress={onReaproveita} />}
        {!rodando && !escolhendo && salvaveis.length > 0 && (
          <Botao rotulo={baixando ? "Salvando…" : salvaveis.length > 1 ? "Salvar todas" : "Salvar"} icone={<Download size={14} color={c.fg} />}
                 desabilitado={baixando} onPress={async () => { setBaixando(true); await onBaixar(salvaveis.map((i) => i.path)); setBaixando(false); }} />
        )}
        {!rodando && prontas.length > 1 && !escolhendo && (
          <Botao rotulo="Escolher" icone={<Check size={14} color={c.fg} />} onPress={() => { setEscolhendo(true); setManter([]); }} />
        )}
        {escolhendo && (
          <>
            <Botao primario rotulo={`Manter ${manter.length} · descartar ${prontas.length - manter.length}`}
                   onPress={() => { setEscolhendo(false); onAcao(`/imagens/${lote.msg.id}/decidir`, { keep: manter }); }} />
            <Botao rotulo="Voltar" icone={<ArrowLeft size={14} color={c.fg} />} onPress={() => setEscolhendo(false)} />
          </>
        )}
      </View>
    </View>
  );
}

/** Imagem em tela cheia: editar a partir dela (vira referência) ou repetir a semente. */
const chaveSlot = (i: Img) => i.destino ?? i.slot;

/** Redesenho: a força e o prompt usados, para a linha de baixo do Visor ("" se o lote não é um redesenho). */
function redesenhoDe(msg?: Msg): string {
  const o = msg?.meta?.opts as { hires?: boolean; hires_scale?: number; hires_denoise?: number } | undefined;
  const a = msg?.meta?.opts?.ampliacao as { forca?: number; prompt?: string } | undefined;
  const n = (x: number) => String(x).replace(".", ",");
  if (o?.hires) return `alta resolução ${n(o.hires_scale ?? 1.5)}× · denoise ${n(o.hires_denoise ?? 0.45)}`;
  return a?.forca == null ? "" : `redesenho · força ${a.forca.toFixed(2).replace(".", ",")}${a.prompt ? ` · “${a.prompt}”` : ""}`;
}

/** Botão da grade de ações (altura 64, ícone em cima, rótulo centralizado e sem quebra). */
export function AcaoGrade({ rotulo, icone, onPress, altura = 64 }: { rotulo: string; icone: React.ReactNode; onPress: () => void; altura?: number }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, height: altura, borderRadius: 14, borderWidth: 1, borderColor: c.line, gap: 6,
                                                             alignItems: "center", justifyContent: "center", backgroundColor: pressed ? c.raised : "transparent" })}>
      {icone}
      <Text style={{ color: c.fg, fontSize: 12.5, textAlign: "center" }} numberOfLines={1} adjustsFontSizeToFit>{rotulo}</Text>
    </Pressable>
  );
}

/** Seta ‹ › de 44 (fundo #0009) nas bordas da área da mídia, centrada na vertical. */
export function SetaMidia({ lado, ativa, onPress }: { lado: "esq" | "dir"; ativa: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!ativa}
               style={{ position: "absolute", top: "50%", marginTop: -22, [lado === "esq" ? "left" : "right"]: 8, width: 44, height: 44, borderRadius: 22,
                        backgroundColor: "#0009", alignItems: "center", justifyContent: "center", opacity: ativa ? 1 : 0.25 }}>
      {lado === "esq" ? <Voltar size={22} color="#fff" /> : <Seta size={22} color="#fff" />}
    </Pressable>
  );
}

function Visor({ img, fila, onI, prompt, detalhe, onFecha, onEditar, onPintar, onSemente, onBaixar, onUsarNoSite, onAmpliar }:
  { img: Img | null; fila: Img[]; onI: (i: Img) => void; prompt: string; detalhe?: string; onFecha: () => void; onEditar?: (p: string) => void;
    onPintar?: (i: Img, w?: number, h?: number) => void; onSemente?: (n: number) => void; onBaixar: (p: string[]) => Promise<void>;
    onUsarNoSite?: () => void; onAmpliar: (i: Img, w?: number, h?: number) => void }) {
  const inset = useSafeAreaInsets();
  const [baixando, setBaixando] = useState(false);
  const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const { width: larg, height: alt } = useWindowDimensions();
  const deitado = larg > alt; // celular girado: só a imagem, as setas e o X, na tela inteira
  const w = tam?.w ?? img?.w ?? img?.width, h = tam?.h ?? img?.h ?? img?.height;
  const r = w && h ? w / h : 1;
  // contida nos dois eixos: retrato ganha faixas pretas nas laterais e não empurra os botões
  const largura = area ? Math.min(area.w, area.h * r) : 0;
  // pinça (1 a 4×), dois dedos movem, e com zoom um dedo também arrasta
  const { vista, zoom, caixa, mede, handlers } = useGestos({ w: largura, h: largura / r });
  useEffect(() => { setTam(null); zoom(1); }, [img?.path]);
  if (!img) return null;
  const k = fila.findIndex((x) => x.path === img.path);
  return (
    <Modal visible animationType="fade" onRequestClose={onFecha} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      <StatusBar hidden={deitado} />
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: deitado ? 0 : inset.top }}>
        {!deitado && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          <BotaoIcone lado={44} fundo="transparent" onPress={onFecha}><X size={22} color={c.fg} /></BotaoIcone>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 14 }} numberOfLines={1}>{prompt || img.nome || "Imagem"}</Text>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>
              {img.nome ? `${img.nome}${img.destino ? " · no site" : ""} · ` : ""}{img.model_name} · semente {img.seed}{w && h ? ` · ${w}×${h}` : ""}
            </Text>
          </View>
        </View>}
        <View style={{ flex: 1, minHeight: 0, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
              onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {!!area && (
            <View ref={caixa} collapsable={false} onLayout={mede} style={{ width: largura, height: largura / r }} {...handlers}>
              <Image source={{ uri: urlImagem(img.path, String(img.seed)) }} resizeMode="contain"
                     style={{ width: largura, height: largura / r, transform: [{ translateX: vista.x }, { translateY: vista.y }, { scale: vista.z }] }}
                     onLoad={(e) => { const s0 = e.nativeEvent.source; if (s0.width && s0.height) setTam({ w: s0.width, h: s0.height }); }} />
            </View>
          )}
          {fila.length > 1 && (
            <>
              <SetaMidia lado="esq" ativa={k > 0} onPress={() => onI(fila[k - 1])} />
              <SetaMidia lado="dir" ativa={k >= 0 && k < fila.length - 1} onPress={() => onI(fila[k + 1])} />
            </>
          )}
          {deitado && (
            <>
              <BotaoIcone lado={44} fundo="#0009" onPress={onFecha} estilo={{ position: "absolute", top: 12, left: 12 + inset.left }}><X size={22} color="#fff" /></BotaoIcone>
              {fila.length > 1 && (
                <Text style={{ position: "absolute", bottom: 12, color: "#fff", fontFamily: mono, fontSize: 11.5, backgroundColor: "#0009", borderRadius: 999,
                               paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" }}>{k + 1} de {fila.length}</Text>
              )}
            </>
          )}
        </View>
        {!deitado && <View style={{ padding: 14, paddingBottom: inset.bottom + 14, gap: 10 }}>
          {fila.length > 1 && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5, textAlign: "center" }}>{k + 1} de {fila.length}</Text>}
          {!!detalhe && <Text style={{ color: c.faint, fontSize: 12, textAlign: "center" }} numberOfLines={2}>{detalhe}</Text>}
          {onUsarNoSite && <Botao primario altura={48} rotulo="Usar no site" icone={<Check size={16} color={c.accentFg} />} onPress={onUsarNoSite} />}
          <Botao primario={!onUsarNoSite} altura={48} rotulo={baixando ? "Salvando…" : "Salvar ou compartilhar"} desabilitado={baixando}
                 icone={<Download size={16} color={onUsarNoSite ? c.fg : c.accentFg} />}
                 onPress={async () => { setBaixando(true); await onBaixar([img.path]); setBaixando(false); }} />
          <View style={{ flexDirection: "row", gap: 6 }}>
            <AcaoGrade rotulo="Ampliar" icone={<Expandir size={18} color={c.fg} />} onPress={() => onAmpliar(img, w, h)} />
            {onEditar && <AcaoGrade rotulo="Editar desta" icone={<Edit size={18} color={c.fg} />} onPress={() => onEditar(img.path)} />}
            {onPintar && <AcaoGrade rotulo="Pintar" icone={<Edit size={18} color={c.fg} />} onPress={() => onPintar(img, w, h)} />}
            {onSemente && <AcaoGrade rotulo="Usar semente" icone={<Repetir size={18} color={c.fg} />} onPress={() => onSemente(img.seed)} />}
          </View>
        </View>}
      </View>
    </Modal>
  );
}

/** Método (ESRGAN que está no PC, SeedVR2, redesenho ou Lanczos) e fator; como o PainelAmpliar do desktop. */
function FolhaAmpliar({ alvo, onFecha, onAmpliar, onErro }:
  { alvo: Ampliar | null; onFecha: () => void; onAmpliar: (fator: number, modelo: string, extra?: { prompt?: string; forca?: number }) => void;
    onErro: (e: string) => void }) {
  const [cat, setCat] = useState<Ampliadores | null>(null);
  const [modelo, setModelo] = useState<string | null>(null);
  const [fator, setFator] = useState(2);
  const [prompt, setPrompt] = useState(alvo?.prompt ?? ""); // a folha nasce de novo a cada imagem (key no pai)
  const [forca, setForca] = useState(0.4);
  useEffect(() => {
    if (!alvo) return;
    api.get<Ampliadores>("/local/video/ampliadores").then(setCat).catch((e) => onErro(e.message));
  }, [alvo]);
  // SeedVR2 e DAT/HAT (spandrel) só com o ComfyUI instalado no PC; o padrão é sempre um ESRGAN (rápido, leve)
  // o redesenho pelo sd-cli (Qwen-Image, Flux) não precisa do ComfyUI
  const metodos = (cat?.no_disco ?? []).filter((m) => (m.tipo ?? "esrgan") === "esrgan" || m.motor === "sd" || !!cat?.comfy?.instalado);
  const escolhido = modelo ?? metodos.find((m) => (m.tipo ?? "esrgan") === "esrgan")?.path ?? "";
  const redesenha = metodos.find((m) => m.path === escolhido)?.tipo === "redesenhar";
  const opcoes = [
    ...metodos.map((m) => ({ id: m.path,
      nome: m.tipo === "redesenhar" ? `Redesenhar com ${m.name}` : m.tipo === "seedvr2" ? "SeedVR2" : m.name,
      dica: m.tipo === "seedvr2" ? "IA pesada: mais detalhe" : m.tipo === "redesenhar" ? "Refaz em alta resolução (muda a imagem)"
        : m.tipo === "spandrel" ? "IA (DAT/HAT, pelo ComfyUI): mais fiel" : "IA (ESRGAN)",
      selo: m.tipo === "seedvr2" || m.tipo === "redesenhar" ? "minutos" : "segundos" })),
    { id: "", nome: "Lanczos", dica: "Rápido, sem IA", selo: "instantâneo" },
  ];
  return (
    <Folha aberta={!!alvo} titulo="Ampliar imagem" onFecha={onFecha}>
      {!cat ? <ActivityIndicator color={c.muted} /> : (
        <>
          <Campo rotulo="Método" dica={metodos.length ? "IA roda na GPU do PC; Lanczos é instantâneo, sem inventar detalhe."
                                      : "Sem modelo de IA no PC: baixe um na tela Imagens do desktop (Ampliar › Baixar o que falta)."}>
            <View style={{ gap: 8 }}>
              {opcoes.map((o) => (
                <Radio key={o.id} on={escolhido === o.id} onPress={() => setModelo(o.id)}
                       direita={<Selo t={o.selo} emMono borda cor={o.selo === "minutos" ? c.warn : c.faint} />}>
                  <Text style={{ color: c.fg, fontSize: 14.5 }} numberOfLines={1}>{o.nome}</Text>
                  <Text style={{ color: c.muted, fontSize: 12.5 }}>{o.dica}</Text>
                </Radio>
              ))}
            </View>
          </Campo>
          <Campo rotulo="Fator">
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[2, 4].map((f) => (
                <CartaoOpcao key={f} altura={60} titulo={`${f}×`} on={fator === f} onPress={() => setFator(f)}
                             sub={alvo?.w && alvo.h ? `${alvo.w * f}×${alvo.h * f}` : undefined} />
              ))}
            </View>
          </Campo>
          {redesenha && (
            <>
              <Campo rotulo="O que desenhar" dica="Em inglês funciona melhor.">
                <Area valor={prompt} onMuda={setPrompt} linhas={3} placeholder="Descreva a imagem" />
              </Campo>
              <Deslizador rotulo="Força" valor={forca} min={0.3} max={0.6} passo={0.05} casas={2} onMuda={setForca}
                          pontas={["fiel, só limpa", "reimagina a textura"]} />
            </>
          )}
          <Botao primario altura={48} rotulo={`Ampliar ${fator}×`} icone={<Expandir size={16} color={c.accentFg} />}
                 onPress={() => onAmpliar(fator, escolhido, redesenha ? { prompt, forca } : {})} />
        </>
      )}
    </Folha>
  );
}

/** Topo da conversa aberta pela IA (skill gerar-imagens): projeto, volta ao chat e a fila de slots pendentes. */
function CartaoOrigem({ origem, temImagens, ocupado, modelos, onChat, onGerar, onAjustes, onEstilo, onOtimizar, children }: {
  origem: Origem; temImagens: boolean; ocupado: boolean; modelos: string[]; onChat: () => void; onGerar: () => void;
  onAjustes: () => void; onEstilo: () => void; onOtimizar: () => void; children?: React.ReactNode;
}) {
  const azul = "#0c4a6e";
  return (
    <View style={{ gap: 12, marginBottom: 6 }}>
      <View style={{ borderColor: azul, borderWidth: 1, borderRadius: 16, backgroundColor: "#082f4933", overflow: "hidden" }}>
        <View style={{ padding: 12, gap: 2 }}>
          <Text style={s.muted}>Aberta pela IA · projeto <Text style={{ color: c.fg, fontWeight: "600" }}>{origem.projeto}</Text></Text>
          <Text style={[s.faint, { fontFamily: mono, fontSize: 11 }]} numberOfLines={1}>{origem.workspace}</Text>
          {origem.chat ? (
            <Pressable onPress={onChat} style={[s.btnSec, { alignSelf: "flex-start", marginTop: 8 }]}>
              <Text style={s.btnSecTxt} numberOfLines={1}>Chat · {origem.chat.title} ›</Text>
            </Pressable>
          ) : <Text style={[s.faint, { marginTop: 6 }]}>O chat que pediu foi apagado.</Text>}
        </View>
        {temImagens && (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", borderTopColor: azul, borderTopWidth: 1, padding: 10 }}>
            <Pressable style={s.btnSec} disabled={ocupado} onPress={onEstilo}><Text style={s.btnSecTxt}>Outro estilo</Text></Pressable>
            <Pressable style={s.btnSec} disabled={ocupado} onPress={onOtimizar}>
              <Text style={s.btnSecTxt}>{origem.web ? "✓ Versão web (.webp)" : "Otimizar para web"}</Text>
            </Pressable>
          </View>
        )}
      </View>
      {origem.pendentes.length > 0 && (
        <View style={{ borderColor: c.line, borderWidth: 1, borderRadius: 16, backgroundColor: c.surface, padding: 12, gap: 10 }}>
          <Text style={[s.txt, { fontWeight: "600" }]}>{origem.pendentes.length} imagens para o site</Text>
          {origem.pendentes.map((x) => (
            <View key={x.caminho} style={{ gap: 2 }}>
              <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12.5 }}>{x.nome}
                <Text style={s.faint}>{x.largura && x.altura ? `  ${x.largura}×${x.altura}` : ""}</Text>
              </Text>
              <Text style={[s.muted, { fontSize: 12.5 }]} numberOfLines={2}>{x.prompt_base || x.prompt}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pressable style={s.btn} disabled={ocupado} onPress={onGerar}>
              <Text style={s.btnTxt}>{ocupado ? "Já tem imagem sendo gerada" : `Gerar ${origem.pendentes.length} imagens`}</Text>
            </Pressable>
            <Pressable style={s.btnSec} onPress={onAjustes}>
              <Text style={s.btnSecTxt}>{modelos.length ? `${modelos.length > 1 ? `${modelos.length} modelos` : modelos[0]} · ajustes` : "Escolher modelo"}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {children}
    </View>
  );
}
