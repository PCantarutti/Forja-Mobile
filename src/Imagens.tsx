import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, enviaArquivo, lerAjustes, type Msg, salvaAjustes, urlImagem } from "./api";
import type { Conv } from "./Chat";
import { pergunta } from "./Dialogo";
import { Cubo, Enviar, Parar } from "./icones";
import { GaleriaSite, TelaSlot, versoesPorSlot } from "./Slots";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Campo, Chip, Contador, Folha, Lista, Seletor } from "./ui";

// LoteImagem do backend (lotes.py / types.ts do desktop).
type Img = { path: string; seed: number; model_name?: string; status: string; progress?: number; preview?: string;
             com_previa?: boolean; restante?: number; s_passo?: number; error?: string;
             nome?: string; destino?: string; slot?: string; mid?: number; prompt?: string }; // slot do site (skill gerar-imagens)
type Slot = { nome: string; caminho: string; rel: string; prompt: string; prompt_base: string; estilo: string; largura: number | null; altura: number | null };
// GET /imagens/{conv}/origem: a conversa que a IA abriu para as imagens de um site (desktop ImagensView Origem).
type Origem = { message_id: number; workspace: string; projeto: string; chat: { id: number; title: string; kind: string } | null;
                slots: Slot[]; pendentes: Slot[]; fora_do_codigo: string[]; estilo: string; web: boolean };
type Lote = { user?: Msg; msg: Msg; imgs: Img[] };
type ModeloImg = { path: string; name: string; params?: Record<string, any> };
type LocalImg = { image: Record<string, any>; image_models: ModeloImg[]; runtimes: any };
type Opts = { steps: number; cfg: number; width: number; height: number; sampler: string; negative: string };
type Ajustes = { models: string[]; count: number; seed: number; seed_mode: string; opts: Opts };

// Listas do desktop (ImagensView / LocalPanel).
const AMOSTRADORES = ["euler_a", "euler", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2mv2", "ipndm", "lcm", "ddim_trailing", "tcd",
  "res_multistep", "er_sde", "dpm++2m_sde", "lms"];
const PROPORCOES = [{ id: "1:1", w: 512, h: 512 }, { id: "3:2", w: 768, h: 512 }, { id: "2:3", w: 512, h: 768 }, { id: "16:9", w: 896, h: 512 }];
const SEMENTES = [{ id: "incremental", rotulo: "Incremental" }, { id: "aleatoria", rotulo: "Aleatória" }, { id: "fixa", rotulo: "Fixa" }];
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

  /** Pedido que o backend recusa com 409 quando há modelo de texto na VRAM: pergunta e repete com confirm. */
  async function comVram(faz: (confirm: boolean) => Promise<unknown>, oQue: string) {
    try { await faz(false); } catch (e: any) {
      if (e.status === 409)
        return pergunta("VRAM ocupada", `${e.message}\n\nDescarregar o modelo de texto e ${oQue}?`,
          [{ texto: "Cancelar", estilo: "cancelar" }, { texto: `Descarregar e ${oQue}`, acao: () => faz(true).then(carrega).catch((er) => setErro(er.message)) }]);
      setErro(e.message);
    }
  }

  async function gera() {
    const texto = prompt.trim();
    if (!texto || !aj?.models.length || !local) return;
    setErro("");
    const opts = Object.fromEntries(Object.entries({ ...local.image, ...aj.opts }).filter(([k]) => !DO_MODELO.includes(k)));
    // A conversa sai antes do comVram: o repetir com confirm é outro closure, com o convId ainda null,
    // e criava uma segunda conversa (o lote rodava nela, a tela ficava na vazia).
    let id = convId;
    if (id == null) {
      try {
        const nova = await api.post<Conv>("/conversations", { kind: "imagem" });
        id = nova.id;
        onCriada(nova);
        convRef.current = id;
        setConvId(id);
      } catch (e: any) { return setErro(e.message); }
    }
    await comVram(async (confirm) => {
      // Como o desktop: o que está na tela também vira o padrão da ferramenta image_generate do agente.
      await api.put("/local/image/defaults", { ...local.image, ...aj.opts, model: aj.models[0] });
      await api.post(`/imagens/${id}/gerar`, { prompt: texto, opts, models: aj.models, count: aj.count, seed: aj.seed,
        seed_mode: aj.seed_mode, confirm, refs });
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
      // Mesmo modelo de texto do chat (ajustes "modelo"), como o picker do desktop começa.
      const m = await lerAjustes<{ provider: string; model: string }>("modelo", { provider: "", model: "" });
      const d = m.model ? m : (await api.get<{ defaults: { provider: string; model: string } }>("/mobile")).defaults;
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
      if (aviso) pergunta("Imagem salva", aviso, [{ texto: "Ok" }]);
    } catch (e: any) {
      if (!/cancel/i.test(String(e?.message))) setErro(e.message); // cancelar o seletor de pasta não é erro
    }
  }
  const nomes = aj?.models.map((p) => local?.image_models.find((m) => m.path === p)?.name ?? "?") ?? [];

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
          </View>
        }
        renderItem={({ item }) => (
          <LoteView lote={item} onVer={setVer} onAcao={acao} onReaproveita={() => reaproveita(item)} onBaixar={baixa}
                    onContinua={() => comVram((confirm) => api.post(`/imagens/${item.msg.id}/continuar`, { confirm }).then(carrega), "continuar")} />
        )}
      />
      {!!erro && <Text style={[s.muted, { color: c.red, paddingHorizontal: 14 }]} onPress={() => setErro("")}>{erro}</Text>}
      {origem ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(inset.bottom, 10) }}>
          <Text style={[s.faint, { flex: 1, fontSize: 12 }]}>Toque numa imagem para ver as versões, regerar ou trocar a do site.</Text>
          <Chip rotulo={nomes.length > 1 ? `${nomes.length} modelos` : nomes[0] ?? "Modelo"} icone={<Cubo size={13} color={c.muted} />}
                onPress={() => setFolha(true)} max={150} />
          <Chip rotulo={`×${aj?.count ?? 1}`} onPress={() => setFolha(true)} />
        </View>
      ) : (
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: teclado ? 8 : Math.max(inset.bottom, 10) }}>
        <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
          {refs.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
              {refs.map((r) => (
                <Pressable key={r} onPress={() => setRefs((x) => x.filter((y) => y !== r))}>
                  <Image source={{ uri: urlImagem(r) }} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: c.raised }} />
                  <Text style={{ position: "absolute", right: 3, top: 1, color: "#fff", fontSize: 12, textShadowColor: "#000", textShadowRadius: 3 }}>✕</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6 }} value={prompt}
                     onChangeText={setPrompt} multiline placeholder={refs.length ? "O que mudar nas referências" : "Descreva a imagem"}
                     placeholderTextColor={c.faint} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
              <Chip rotulo={refs.length ? `📎 ${refs.length}` : "📎"} onPress={anexaRef} />
              <Chip rotulo={nomes.length > 1 ? `${nomes.length} modelos` : nomes[0] ?? "Modelo"} icone={<Cubo size={13} color={c.muted} />}
                    onPress={() => setFolha(true)} max={180} />
              <Chip rotulo={`×${aj?.count ?? 4}`} onPress={() => setFolha(true)} />
              <Chip rotulo={melhorando ? "melhorando…" : "✨ Melhorar"} onPress={melhora} />
            </ScrollView>
            <Pressable onPress={gera} disabled={!prompt.trim() || !aj?.models.length}
                       style={[redondo, { opacity: prompt.trim() && aj?.models.length ? 1 : 0.35 }]}>
              <Enviar size={18} color="#000" />
            </Pressable>
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
        <Folha aberta={folha} titulo="Ajustes da geração" onFecha={() => setFolha(false)}>
          <Campo rotulo="Modelos" dica="Com mais de um, as variações se dividem entre eles.">
            {local.image_models.map((m) => {
              const on = aj.models.includes(m.path);
              return (
                <Pressable key={m.path} onPress={() => {
                  // Marcar um modelo traz os parâmetros dele (passos, cfg, tamanho, amostrador), como no desktop.
                  const models = on ? aj.models.filter((p) => p !== m.path) : [...aj.models, m.path];
                  const pr = !on && m.params ? Object.fromEntries(Object.entries(m.params).filter(([k]) => k in aj.opts)) : {};
                  muda({ models, opts: { ...aj.opts, ...pr } });
                }} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: on ? c.raised : "transparent" }}>
                  <Text style={{ color: on ? c.fg : c.faint, fontSize: 16 }}>{on ? "☑" : "☐"}</Text>
                  <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{m.name}</Text>
                </Pressable>
              );
            })}
          </Campo>
          <Campo rotulo="Variações"><Contador valor={aj.count} min={1} max={50} onMuda={(n) => muda({ count: n })} /></Campo>
          <Campo rotulo="Negativo">
            <TextInput style={s.input} value={aj.opts.negative} onChangeText={(t) => mudaOpts({ negative: t })} multiline
                       placeholder="O que evitar na imagem" placeholderTextColor={c.faint} />
          </Campo>
          <Campo rotulo="Proporção">
            <Seletor opcoes={PROPORCOES.map((p) => ({ id: p.id, rotulo: `${p.id} · ${p.w}×${p.h}` }))}
                     valor={PROPORCOES.find((p) => p.w === aj.opts.width && p.h === aj.opts.height)?.id ?? ""}
                     onMuda={(id) => { const p = PROPORCOES.find((x) => x.id === id)!; mudaOpts({ width: p.w, height: p.h }); }} />
          </Campo>
          <Campo rotulo="Largura"><Contador valor={aj.opts.width} min={256} max={2048} passo={64} sufixo="px" onMuda={(n) => mudaOpts({ width: n })} /></Campo>
          <Campo rotulo="Altura"><Contador valor={aj.opts.height} min={256} max={2048} passo={64} sufixo="px" onMuda={(n) => mudaOpts({ height: n })} /></Campo>
          <Campo rotulo="Passos"><Contador valor={aj.opts.steps} min={1} max={150} onMuda={(n) => mudaOpts({ steps: n })} /></Campo>
          <Campo rotulo="CFG"><Contador valor={aj.opts.cfg} min={0} max={30} passo={0.5} onMuda={(n) => mudaOpts({ cfg: n })} /></Campo>
          <Campo rotulo="Amostrador">
            <Seletor opcoes={AMOSTRADORES.map((a) => ({ id: a, rotulo: a }))} valor={aj.opts.sampler} onMuda={(v) => mudaOpts({ sampler: v })} />
          </Campo>
          <Campo rotulo="Sementes">
            <Seletor opcoes={SEMENTES} valor={aj.seed_mode} onMuda={(v) => muda({ seed_mode: v })} />
          </Campo>
          {aj.seed_mode !== "aleatoria" && (
            <Campo rotulo="Semente base" dica="0 = escolhe uma ao acaso.">
              <Contador valor={aj.seed} min={0} max={2147483647} onMuda={(n) => muda({ seed: n })} />
            </Campo>
          )}
        </Folha>
      )}

      <Folha aberta={!!salvar} titulo={salvar && salvar.length > 1 ? `Salvar ${salvar.length} imagens` : "Salvar imagem"} onFecha={() => setSalvar(null)}>
        <Lista<Destino> valor={"" as Destino} onEscolhe={paraDestino} opcoes={[
          { id: "galeria", rotulo: "Galeria", dica: "Aparece na galeria, junto das fotos da câmera (DCIM)" },
          { id: "pasta", rotulo: "Escolher pasta…", dica: "Qualquer pasta do celular ou do cartão (seletor do Android)" },
          ...(salvar?.length === 1 ? [{ id: "compartilhar" as Destino, rotulo: "Compartilhar…", dica: "WhatsApp, Drive, e-mail ou outro app" }] : []),
        ]} />
      </Folha>

      <TelaSlot slot={slotAberto} info={origem?.slots.find((x) => x.caminho === slotAberto)} itens={slotAberto ? versoes.get(slotAberto) ?? [] : []}
                count={aj?.count ?? 1} onCount={(n) => muda({ count: n })} ocupado={rodando || !!(local as any)?.image_busy}
                onEscolher={(path) => slotAberto && acao(`/imagens/${convId}/escolher`, { slot: slotAberto, path })}
                onRegerar={(p) => slotAberto && regerarSlot(slotAberto, p)}
                onParar={(ids) => Promise.all(ids.map((id) => api.post(`/imagens/${id}/cancelar`).catch(() => {}))).then(carrega)}
                onZoom={(img) => setVer(img as Img)} onFecha={() => setSlotAberto(null)} />

      <Visor img={ver} onFecha={() => setVer(null)} onBaixar={baixa}
             onEditar={origem ? undefined : (p) => { setRefs((x) => (x.includes(p) || x.length >= MAX_REFS ? x : [...x, p])); setVer(null); }}
             onSemente={origem ? undefined : (n) => { muda({ seed: n, seed_mode: "fixa" }); setVer(null); }}
             onUsarNoSite={ver && chaveSlot(ver) && !ver.destino ? () => { const v = ver; setVer(null); acao(`/imagens/${convId}/escolher`, { slot: chaveSlot(v), path: v.path }); } : undefined} />
    </View>
  );
}

const redondo = { width: 36, height: 36, borderRadius: 18, backgroundColor: c.fg, alignItems: "center" as const, justifyContent: "center" as const };

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
  const refazer = lote.imgs.filter((i) => REFAZIVEIS.includes(i.status)).length;
  return (
    <View style={{ gap: 10 }}>
      {!!lote.user?.content && (
        <View style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: c.raised, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={s.txt} selectable>{lote.user.content}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {lote.imgs.map((img) => {
          // Prévia ao vivo: o sd-cli regrava o arquivo de prévia a cada passo; o &v= fura o cache da imagem.
          const src = img.status === "gerando" && img.preview ? urlImagem(img.preview, String(img.progress ?? 0)) :
                      ["pronta", "mantida"].includes(img.status) ? urlImagem(img.path) : null;
          const marcada = manter.includes(img.path);
          return (
            <Pressable key={img.path + img.seed} style={{ width: lado, height: lado * 1.25, borderRadius: 14, overflow: "hidden",
                         backgroundColor: c.surface, borderColor: marcada ? c.fg : c.line, borderWidth: marcada ? 2 : 1 }}
                       onPress={() => (escolhendo && img.status === "pronta"
                         ? setManter((m) => (marcada ? m.filter((p) => p !== img.path) : [...m, img.path]))
                         : ["pronta", "mantida"].includes(img.status) && onVer(img))}>
              {src ? <Image source={{ uri: src }} style={{ flex: 1 }} resizeMode="cover" fadeDuration={0} /> : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  {img.status === "gerando" || img.status === "pendente" ? <ActivityIndicator color={c.muted} /> : null}
                </View>
              )}
              {!!img.nome && img.status === "pronta" && !rodando && (
                <Text style={{ position: "absolute", left: 6, bottom: 6, color: "#fff", fontSize: 11, fontFamily: mono, backgroundColor: "#000a",
                               borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }} numberOfLines={1}>{img.destino ? "● " : ""}{img.nome}</Text>
              )}
              {(img.status !== "pronta" || rodando) && !!ROTULO[img.status] && (
                <View style={{ position: "absolute", left: 6, bottom: 6, right: 6, backgroundColor: "#000b", borderRadius: 8, padding: 6 }}>
                  <Text style={{ color: img.status === "erro" ? c.red : c.fg, fontSize: 12 }} numberOfLines={2}>
                    {ROTULO[img.status]}{img.status === "gerando" && img.progress != null ? ` ${Math.round(img.progress * 100)}%` : ""}
                    {img.status === "gerando" && img.restante ? ` · ~${Math.ceil(img.restante)}s` : ""}{img.error ? ` · ${img.error}` : ""}
                  </Text>
                  {img.status === "gerando" && (
                    <View style={{ height: 3, backgroundColor: c.line, borderRadius: 2, marginTop: 4 }}>
                      <View style={{ height: 3, width: `${Math.round((img.progress ?? 0) * 100)}%`, backgroundColor: c.fg, borderRadius: 2 }} />
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {rodando && (
          <Pressable style={[s.btnSec, { flexDirection: "row", gap: 6 }]} onPress={() => onAcao(`/imagens/${lote.msg.id}/cancelar`)}>
            <Parar size={13} /><Text style={s.btnSecTxt}>Cancelar lote</Text>
          </Pressable>
        )}
        {!rodando && refazer > 0 && (
          <Pressable style={s.btnSec} onPress={onContinua}><Text style={s.btnSecTxt}>Continuar ({refazer})</Text></Pressable>
        )}
        {!rodando && prontas.length > 1 && !escolhendo && (
          <Pressable style={s.btnSec} onPress={() => { setEscolhendo(true); setManter([]); }}>
            <Text style={s.btnSecTxt}>Escolher quais manter</Text>
          </Pressable>
        )}
        {!rodando && !escolhendo && (
          <Pressable style={s.btnSec} onPress={onReaproveita}><Text style={s.btnSecTxt}>Reaproveitar</Text></Pressable>
        )}
        {!rodando && !escolhendo && lote.imgs.some((i) => ["pronta", "mantida"].includes(i.status)) && (
          <Pressable style={s.btnSec} disabled={baixando}
                     onPress={async () => { setBaixando(true); await onBaixar(lote.imgs.filter((i) => ["pronta", "mantida"].includes(i.status)).map((i) => i.path)); setBaixando(false); }}>
            <Text style={s.btnSecTxt}>{baixando ? "Salvando…" : prontas.length + lote.imgs.filter((i) => i.status === "mantida").length > 1 ? "Salvar todas" : "Salvar"}</Text>
          </Pressable>
        )}
        {escolhendo && (
          <>
            <Pressable style={s.btn} onPress={() => { setEscolhendo(false); onAcao(`/imagens/${lote.msg.id}/decidir`, { keep: manter }); }}>
              <Text style={s.btnTxt}>Manter {manter.length} · descartar {prontas.length - manter.length}</Text>
            </Pressable>
            <Pressable style={s.btnSec} onPress={() => setManter(manter.length === prontas.length ? [] : prontas.map((i) => i.path))}>
              <Text style={s.btnSecTxt}>{manter.length === prontas.length ? "Limpar seleção" : "Marcar todas"}</Text>
            </Pressable>
            <Pressable style={s.btnSec} onPress={() => setEscolhendo(false)}><Text style={s.btnSecTxt}>Voltar</Text></Pressable>
          </>
        )}
      </View>
    </View>
  );
}

/** Imagem em tela cheia: editar a partir dela (vira referência) ou repetir a semente. */
const chaveSlot = (i: Img) => i.destino ?? i.slot;

function Visor({ img, onFecha, onEditar, onSemente, onBaixar, onUsarNoSite }:
  { img: Img | null; onFecha: () => void; onEditar?: (p: string) => void; onSemente?: (n: number) => void; onBaixar: (p: string[]) => Promise<void>;
    onUsarNoSite?: () => void }) {
  const inset = useSafeAreaInsets();
  const [baixando, setBaixando] = useState(false);
  const [proporcao, setProporcao] = useState(0.75); // largura/altura real, vinda do onLoad
  if (!img) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onFecha} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <Pressable style={{ flex: 1 }} onPress={onFecha}>
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
            <Image source={{ uri: urlImagem(img.path, String(img.seed)) }} style={{ width: "100%", aspectRatio: proporcao }} resizeMode="contain"
                   onLoad={(e) => { const { width, height } = e.nativeEvent.source; if (width && height) setProporcao(width / height); }} />
          </ScrollView>
        </Pressable>
        <View style={{ padding: 14, paddingBottom: inset.bottom + 14, gap: 10 }}>
          <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12, textAlign: "center" }}>
            {img.nome ? `${img.nome}${img.destino ? " · no site" : ""} · ` : ""}{img.model_name} · semente {img.seed}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {onUsarNoSite && <Pressable style={s.btn} onPress={onUsarNoSite}><Text style={s.btnTxt}>Usar no site</Text></Pressable>}
            <Pressable style={s.btn} disabled={baixando} onPress={async () => { setBaixando(true); await onBaixar([img.path]); setBaixando(false); }}>
              <Text style={s.btnTxt}>{baixando ? "Salvando…" : "Salvar ou compartilhar"}</Text>
            </Pressable>
            {onEditar && <Pressable style={s.btnSec} onPress={() => onEditar(img.path)}><Text style={s.btnSecTxt}>Editar a partir desta</Text></Pressable>}
            {onSemente && <Pressable style={s.btnSec} onPress={() => onSemente(img.seed)}><Text style={s.btnSecTxt}>Usar esta semente</Text></Pressable>}
          </View>
        </View>
      </View>
    </Modal>
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
