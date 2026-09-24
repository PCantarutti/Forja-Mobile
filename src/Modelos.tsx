import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, SectionList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "./api";
import { Cubo } from "./icones";
import { Deslizante } from "./ui";
import { c, s } from "./tema";

/** Escolha de modelo como o ModelPicker do desktop: provedor+modelo do /catalog, ou um .gguf local (path). */
export type Escolha = { provider?: string; model?: string; path?: string; nome: string };
type Catalogo = { id: string; name: string; models: string[]; error?: string }[];

export const chave = (e: Escolha) => e.path ?? `${e.provider}/${e.model}`;

// O /catalog leva ~2 s (sonda Ollama/LM Studio desligados): a última lista aparece na hora e se atualiza por trás.
const ultima: Record<string, { title: string; erro?: string; data: Escolha[] }[]> = {};

/** Folha de modelos: `max` = 1 escolhe e fecha; > 1 marca vários (Comparar). */
export default function Modelos({ aberto, max = 1, marcados = [], soProvedor = false, onFecha, onEscolhe }: {
  aberto: boolean; max?: number; marcados?: Escolha[]; soProvedor?: boolean;
  onFecha: () => void; onEscolhe: (e: Escolha[]) => void;
}) {
  const inset = useSafeAreaInsets();
  const [secoes, setSecoes] = useState<{ title: string; erro?: string; data: Escolha[] }[] | null>(ultima[String(soProvedor)] ?? null);
  const [sel, setSel] = useState<Escolha[]>(marcados);

  useEffect(() => {
    if (!aberto) return;
    setSel(marcados);
    Promise.all([
      api.get<Catalogo>("/catalog").catch(() => [] as Catalogo),
      soProvedor ? Promise.resolve(null) : api.get<any>("/local").catch(() => null),
    ]).then(([cat, local]) => {
      const out = cat.filter((p) => p.models.length || p.error).map((p) => ({
        title: p.name, erro: p.models.length ? undefined : p.error,
        data: p.models.map((m) => ({ provider: p.id, model: m, nome: m })),
      }));
      const ggufs = (local?.models ?? []).filter((m: any) => m.kind === "chat");
      if (ggufs.length) out.push({ title: "Arquivos .gguf (carrega um por vez)", erro: undefined,
        data: ggufs.map((m: any) => ({ path: m.path, nome: m.name })) });
      ultima[String(soProvedor)] = out;
      setSecoes(out);
    });
  }, [aberto]);

  const alterna = (e: Escolha) => {
    if (max === 1) return onEscolhe([e]);
    setSel((x) => (x.some((y) => chave(y) === chave(e)) ? x.filter((y) => chave(y) !== chave(e)) : x.length < max ? [...x, e] : x));
  };

  return (
    <Deslizante aberta={aberto} onFecha={onFecha}>
      <View style={{ height: "75%", backgroundColor: c.side, borderTopLeftRadius: 22, borderTopRightRadius: 22,
                     paddingBottom: inset.bottom + 8, borderColor: c.line, borderWidth: 1 }}>
        <Text style={{ color: c.fg, fontSize: 16, fontWeight: "600", padding: 16 }}>
          {max === 1 ? "Modelo" : `Modelos para comparar (${sel.length}/${max})`}
        </Text>
        {!secoes ? <ActivityIndicator color={c.muted} /> : (
          <SectionList
            sections={secoes}
            keyExtractor={chave}
            contentContainerStyle={{ paddingHorizontal: 8 }}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View style={{ paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 }}>
                <Text style={s.secao}>{section.title}</Text>
                {!!section.erro && <Text style={[s.faint, { fontSize: 12 }]} numberOfLines={2}>{section.erro}</Text>}
              </View>
            )}
            renderItem={({ item }) => {
              const on = sel.some((y) => chave(y) === chave(item));
              return (
                <Pressable onPress={() => alterna(item)}
                           style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12,
                                    backgroundColor: on ? c.raised : "transparent" }}>
                  <Cubo size={16} color={on ? c.fg : c.faint} />
                  <Text style={{ flex: 1, color: c.fg, fontSize: 15 }} numberOfLines={1}>{item.nome}</Text>
                  {on && <Text style={{ color: c.fg }}>✓</Text>}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={[s.faint, { padding: 16 }]}>Nenhum provedor respondeu.</Text>}
          />
        )}
        {max > 1 && (
          <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
            <Pressable style={[s.btn, sel.length < 2 && { opacity: 0.4 }]} disabled={sel.length < 2} onPress={() => onEscolhe(sel)}>
              <Text style={s.btnTxt}>Usar {sel.length} modelos</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Deslizante>
  );
}
