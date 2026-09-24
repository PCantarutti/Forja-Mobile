import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "./api";
import { Pasta as IconePasta, Seta, Voltar } from "./icones";
import { Deslizante } from "./ui";
import { c, mono, s } from "./tema";

type Listagem = { path: string; parent: string | null; dirs: { name: string; path: string }[] };
type Raizes = { drives: { name: string; path: string }[]; recent: string[]; default: string };

/** Último segmento do caminho, como o chip de pasta do desktop (FolderPicker.tsx, folderName). */
export const nomePasta = (p?: string | null) => p?.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** Seletor de pasta do PC para a conversa nova: recentes, discos e navegação por subpastas (/api/fs/*). */
export default function EscolhePasta({ aberta, atual, onEscolhe, onFecha }:
  { aberta: boolean; atual: string | null; onEscolhe: (p: string) => void; onFecha: () => void }) {
  const inset = useSafeAreaInsets();
  const [raizes, setRaizes] = useState<Raizes | null>(null);
  const [lista, setLista] = useState<Listagem | null>(null); // null = tela inicial (recentes + discos)
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!aberta) return;
    setLista(null);
    setErro("");
    api.get<Raizes>("/fs/roots").then(setRaizes).catch((e) => setErro(e.message));
  }, [aberta]);

  const abre = (path: string) => {
    setCarregando(true);
    setErro("");
    api.get<Listagem>(`/fs/list?path=${encodeURIComponent(path)}`).then(setLista).catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  };

  const linha = (rotulo: string, sub: string | null, onPress: () => void, destaque = false) => (
    <Pressable onPress={onPress}
               style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12,
                 borderRadius: 12, backgroundColor: destaque ? c.raised : pressed ? c.surface : "transparent" })}>
      <IconePasta size={19} color={c.muted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.fg, fontSize: 15.5 }} numberOfLines={1}>{rotulo}</Text>
        {!!sub && <Text style={[s.faint, { fontFamily: mono, fontSize: 11.5 }]} numberOfLines={1}>{sub}</Text>}
      </View>
      <Seta size={16} color={c.faint} />
    </Pressable>
  );

  return (
    <Deslizante aberta={aberta} onFecha={onFecha} onVoltar={() => (lista ? setLista(null) : onFecha())}>
      <View style={{ height: "78%", backgroundColor: c.side, borderTopLeftRadius: 22, borderTopRightRadius: 22,
                     paddingBottom: inset.bottom + 8, borderColor: c.line, borderWidth: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
          {lista && <Pressable hitSlop={10} onPress={() => (lista.parent ? abre(lista.parent) : setLista(null))}><Voltar size={20} /></Pressable>}
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
              {lista ? nomePasta(lista.path) || lista.path : "Pasta de trabalho"}
            </Text>
            {lista && <Text style={[s.faint, { fontFamily: mono, fontSize: 11.5 }]} numberOfLines={1}>{lista.path}</Text>}
          </View>
          {carregando && <ActivityIndicator size="small" color={c.muted} />}
        </View>
        {!!erro && <Text style={[s.muted, { color: c.red, paddingHorizontal: 16, paddingBottom: 8 }]}>{erro}</Text>}
        {lista ? (
          <>
            <FlatList data={lista.dirs} keyExtractor={(d) => d.path} contentContainerStyle={{ paddingHorizontal: 8 }}
                      ListEmptyComponent={<Text style={[s.faint, { padding: 14 }]}>Sem subpastas.</Text>}
                      renderItem={({ item }) => linha(item.name, null, () => abre(item.path))} />
            <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
              <Pressable style={s.btn} onPress={() => onEscolhe(lista.path)}>
                <Text style={s.btnTxt}>Usar “{nomePasta(lista.path) || lista.path}”</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <FlatList
            data={[...(raizes?.recent ?? []).map((p) => ({ tipo: "recente", path: p })),
                   ...(raizes?.drives ?? []).map((d) => ({ tipo: "disco", path: d.path, nome: d.name }))]}
            keyExtractor={(x) => x.tipo + x.path}
            contentContainerStyle={{ paddingHorizontal: 8 }}
            renderItem={({ item, index }) => (
              <View>
                {(index === 0 || index === (raizes?.recent.length ?? 0)) && ( // 1º de cada grupo leva o título
                  <Text style={[s.secao, { paddingHorizontal: 14, paddingTop: index ? 16 : 4, paddingBottom: 6 }]}>
                    {item.tipo === "recente" ? "Recentes" : "Discos"}
                  </Text>
                )}
                {item.tipo === "recente"
                  // Recente: toque usa direto (é o caso comum); a seta de navegar fica no disco.
                  ? linha(nomePasta(item.path), item.path, () => onEscolhe(item.path), item.path === atual)
                  : linha((item as any).nome || item.path, null, () => abre(item.path))}
              </View>
            )}
          />
        )}
      </View>
    </Deslizante>
  );
}
