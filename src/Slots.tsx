import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { urlImagem } from "./api";
import { Parar, Voltar } from "./icones";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Contador } from "./ui";

// Imagens de um site (skill gerar-imagens). O desktop mostra os lotes em ordem e as versões de cada slot num
// modal (ImagensView Variacoes); no celular a conversa vira a galeria do site — um cartão por slot, com a
// versão que o site usa — e cada slot abre numa tela com as versões, o prompt e as ações.

export type ImgSlot = { path: string; seed: number; model_name?: string; status: string; progress?: number; preview?: string;
                        restante?: number; error?: string; nome?: string; destino?: string; slot?: string; prompt?: string; mid?: number };
export type Versao = { img: ImgSlot; lote: { id: number; status?: string | null } };
export type SlotInfo = { nome: string; caminho: string; prompt: string; largura: number | null; altura: number | null };

const FALHOU = ["cancelada", "erro", "interrompida"];
export const chaveDe = (i: ImgSlot) => i.destino ?? i.slot;
const pronta = (i: ImgSlot) => ["pronta", "mantida"].includes(i.status);
const gerando = (i: ImgSlot) => ["pendente", "gerando"].includes(i.status);

/** Todas as versões de cada slot, de todos os lotes (as que falharam não são versão). */
export function versoesPorSlot(lotes: { msg: { id: number; status?: string | null }; imgs: ImgSlot[] }[]) {
  const m = new Map<string, Versao[]>();
  for (const l of lotes)
    for (const img of l.imgs) {
      const k = chaveDe(img);
      if (k && !FALHOU.includes(img.status)) m.set(k, [...(m.get(k) ?? []), { img, lote: l.msg }]);
    }
  return m;
}

/** Prévia ao vivo enquanto gera; pronta com a semente na URL (a do site é regravada no mesmo caminho ao trocar). */
const fonte = (i: ImgSlot) =>
  i.status === "gerando" && i.preview ? urlImagem(i.preview, String(i.progress ?? 0)) : pronta(i) ? urlImagem(i.path, String(i.seed)) : null;

function Estado({ img, pequeno }: { img: ImgSlot; pequeno?: boolean }) {
  if (!gerando(img)) return null;
  return (
    <View style={{ position: "absolute", left: 6, right: 6, bottom: 6, backgroundColor: "#000b", borderRadius: 8, padding: 6 }}>
      <Text style={{ color: c.fg, fontSize: pequeno ? 11 : 12 }} numberOfLines={1}>
        {img.status === "pendente" ? "na fila" : `gerando ${Math.round((img.progress ?? 0) * 100)}%`}
        {img.status === "gerando" && img.restante ? ` · ~${Math.ceil(img.restante)}s` : ""}
      </Text>
      {img.status === "gerando" && (
        <View style={{ height: 3, backgroundColor: c.line, borderRadius: 2, marginTop: 4 }}>
          <View style={{ height: 3, width: `${Math.round((img.progress ?? 0) * 100)}%`, backgroundColor: c.fg, borderRadius: 2 }} />
        </View>
      )}
    </View>
  );
}

const pilha = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0, borderRadius: 14, borderWidth: 1, borderColor: c.line };

/** Galeria do site: cada slot com a versão no site; o que está gerando mostra a prévia por cima. */
export function GaleriaSite({ slots, versoes, fora, onAbrir }: {
  slots: SlotInfo[]; versoes: Map<string, Versao[]>; fora: Set<string>; onAbrir: (caminho: string) => void;
}) {
  const { width } = useWindowDimensions();
  const util = width - 24;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {slots.map((sl) => {
        const vs = versoes.get(sl.caminho) ?? [];
        const noSite = vs.find((v) => v.img.destino)?.img ?? vs.find((v) => pronta(v.img))?.img;
        const viva = vs.find((v) => gerando(v.img))?.img; // versão nova saindo agora
        const mostra = viva?.preview && viva.status === "gerando" ? viva : noSite ?? viva;
        const prop = sl.largura && sl.altura ? sl.largura / sl.altura : 1;
        const largo = prop > 1.3; // banner/destaque ocupa a linha inteira
        const w = largo ? util : (util - 8) / 2;
        const src = mostra ? fonte(mostra) : null;
        return (
          <View key={sl.caminho} style={{ width: w, marginTop: vs.length > 1 ? 8 : 0 }}>
          {/* Fotos empilhadas por trás: o slot tem mais versões para escolher. */}
          {vs.length > 2 && <View style={[pilha, { transform: [{ translateX: 8 }, { translateY: -8 }, { rotate: "3deg" }], backgroundColor: "#232323" }]} />}
          {vs.length > 1 && <View style={[pilha, { transform: [{ translateX: 4 }, { translateY: -4 }, { rotate: "1.5deg" }], backgroundColor: "#2a2a2a" }]} />}
          <Pressable onPress={() => vs.length && onAbrir(sl.caminho)}
                     style={{ width: w, borderRadius: 14, overflow: "hidden", backgroundColor: c.surface,
                              borderColor: noSite?.destino ? "#10b98188" : c.line, borderWidth: 1 }}>
            <View style={{ width: w, height: w / Math.max(0.6, Math.min(prop, 2.4)), backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
              {src ? <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} resizeMode="cover" fadeDuration={0} />
                : viva ? <ActivityIndicator color={c.muted} />
                : <Text style={[s.faint, { fontSize: 12 }]}>ainda não gerada</Text>}
              {viva && <Estado img={viva} pequeno={!largo} />}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8 }}>
              <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12, flex: 1 }} numberOfLines={1}>{sl.nome}</Text>
              {fora.has(sl.caminho) ? <Text style={{ color: c.amber, fontSize: 11 }}>fora do código</Text>
                : vs.length > 1 ? <Text style={[s.faint, { fontSize: 11 }]}>{vs.length} versões</Text> : null}
            </View>
          </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** Um slot em tela cheia: as versões (a do site primeiro), o prompt editável e regerar/escolher. */
export function TelaSlot({ slot, info, itens, count, ocupado, onCount, onEscolher, onRegerar, onParar, onZoom, onFecha }: {
  slot: string | null; info?: SlotInfo; itens: Versao[]; count: number; ocupado: boolean; onCount: (n: number) => void;
  onEscolher: (path: string) => void; onRegerar: (prompt?: string) => void; onParar: (loteIds: number[]) => void;
  onZoom: (img: ImgSlot) => void; onFecha: () => void;
}) {
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const { width } = useWindowDimensions();
  // A do site primeiro; depois as mais novas.
  const ordem = [...itens].reverse().sort((a, b) => Number(!!b.img.destino) - Number(!!a.img.destino));
  const original = ordem[0]?.img.prompt ?? info?.prompt ?? "";  // o da versão que o site mostra
  const daIa = info?.prompt || itens[0]?.img.prompt || "";      // o que a IA escreveu
  const [prompt, setPrompt] = useState(original);
  const [editando, setEditando] = useState(false);
  useEffect(() => { setPrompt(original); setEditando(false); }, [slot]); // outro slot: volta ao prompt dele
  if (!slot) return null;
  const editado = prompt.trim() !== original.trim();
  const rodando = [...new Set(itens.filter((v) => v.lote.status === "running").map((v) => v.lote.id))];
  const nome = info?.nome ?? itens[0]?.img.nome ?? slot.split(/[\\/]/).pop();
  const prop = info?.largura && info?.altura ? info.largura / info.altura : 1;
  const lado = (width - 24 - 8) / 2;
  return (
    <Modal visible animationType="slide" onRequestClose={onFecha} statusBarTranslucent>
      <View style={[s.tela, { paddingTop: inset.top, paddingBottom: teclado }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          <Pressable onPress={onFecha} hitSlop={10} style={{ padding: 10 }}><Voltar size={22} /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontFamily: mono, fontSize: 15 }} numberOfLines={1}>{nome}</Text>
            <Text style={[s.faint, { fontSize: 12 }]}>
              {itens.length} {itens.length === 1 ? "versão" : "versões"}{info?.largura ? ` · ${info.largura}×${info.altura}` : ""} · a de borda verde está no site
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          {/* Prompt recolhido numa linha; tocar abre para editar (no celular o texto inteiro empurrava as versões para baixo). */}
          <View style={{ backgroundColor: c.surface, borderColor: editado ? c.amberLine : c.line, borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 }}>
            <Pressable onPress={() => setEditando(!editando)} style={{ gap: 4 }}>
              <Text style={[s.secao, editado && { color: c.amber }]}>
                {editado ? "Prompt editado · as próximas versões usam este texto" : "Prompt · toque para editar e regerar diferente"}
              </Text>
              {!editando && <Text style={[s.muted, { fontSize: 13 }]} numberOfLines={2}>{prompt}</Text>}
            </Pressable>
            {editando && (
              <TextInput style={[s.input, { minHeight: 110, textAlignVertical: "top" }]} value={prompt} onChangeText={setPrompt} multiline
                         autoFocus placeholderTextColor={c.faint} />
            )}
            {(editado || prompt.trim() !== daIa.trim()) && (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {editado && original.trim() !== daIa.trim() && (
                  <Pressable style={s.btnSec} onPress={() => setPrompt(original)}><Text style={s.btnSecTxt}>↶ O da imagem do site</Text></Pressable>
                )}
                {!!daIa && prompt.trim() !== daIa.trim() && (
                  <Pressable style={s.btnSec} onPress={() => setPrompt(daIa)}><Text style={s.btnSecTxt}>Prompt original da IA</Text></Pressable>
                )}
              </View>
            )}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {ordem.map(({ img, lote }) => {
              const noSite = !!img.destino;
              const src = fonte(img);
              return (
                <View key={img.path + img.seed} style={{ width: lado, borderRadius: 14, overflow: "hidden", backgroundColor: c.surface,
                                                           borderColor: noSite ? "#10b981" : c.line, borderWidth: noSite ? 2 : 1 }}>
                  <Pressable onPress={() => pronta(img) && onZoom(img)}
                             style={{ width: "100%", aspectRatio: Math.max(0.75, Math.min(prop, 1.8)), backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
                    {src ? <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} resizeMode="cover" fadeDuration={0} />
                      : <ActivityIndicator color={c.muted} />}
                    <Estado img={img} pequeno />
                  </Pressable>
                  <View style={{ padding: 8, gap: 6 }}>
                    <Text style={[s.faint, { fontSize: 11, fontFamily: mono }]} numberOfLines={1}>semente {img.seed}</Text>
                    {!!img.prompt && img.prompt.trim() !== original.trim() && (
                      <Pressable onPress={() => { setPrompt(img.prompt!); setEditando(true); }}>
                        <Text style={{ color: c.amber, fontSize: 11 }}>outro prompt · usar este texto</Text>
                      </Pressable>
                    )}
                    {noSite ? (
                      <Text style={{ color: "#6ee7b7", fontSize: 12.5, fontWeight: "600" }}>● no site</Text>
                    ) : pronta(img) ? (
                      // A troca é na hora: o arquivo do site é regravado e a anterior fica como versão.
                      <Pressable style={[s.btnSec, { paddingVertical: 7 }]} disabled={lote.status === "running"} onPress={() => onEscolher(img.path)}>
                        <Text style={[s.btnSecTxt, { fontSize: 13, textAlign: "center" }, lote.status === "running" && { color: c.faint }]}>Usar no site</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Ações fixas embaixo, ao alcance do polegar. */}
        <View style={{ borderTopColor: c.line, borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 10,
                       paddingBottom: teclado ? 10 : Math.max(inset.bottom, 12), gap: 10, backgroundColor: c.bg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={[s.muted, { flex: 1, fontSize: 12.5 }]}>
              {ocupado ? "Gerando… o site só muda quando você usar uma." : "Mesmo tamanho, sementes novas. O site só muda quando você usar uma."}
            </Text>
            <Contador valor={count} min={1} max={10} onMuda={onCount} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {rodando.length > 0 && (
              <Pressable style={[s.btnSec, { flexDirection: "row", gap: 6, alignItems: "center" }]} onPress={() => onParar(rodando)}>
                <Parar size={13} /><Text style={s.btnSecTxt}>Parar</Text>
              </Pressable>
            )}
            <Pressable style={[s.btn, { flex: 1, alignItems: "center" }, (ocupado || !prompt.trim()) && { opacity: 0.4 }]}
                       disabled={ocupado || !prompt.trim()} onPress={() => { Keyboard.dismiss(); setEditando(false); onRegerar(editado ? prompt.trim() : undefined); }}>
              <Text style={s.btnTxt}>Regerar mais {count}{editado ? " com o prompt editado" : ""}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
