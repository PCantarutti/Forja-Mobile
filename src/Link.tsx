import { useEffect, useState } from "react";
import { Linking, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "./api";
import { pergunta } from "./Dialogo";
import Site, { type Servidor } from "./Site";
import { Voltar } from "./icones";
import { c, s } from "./tema";

// localhost do PC: no celular ele é o próprio celular, e o link abria vazio. Vira o servidor daquela porta,
// publicado pela rede local ou pela tailnet (o mesmo caminho da página Sites).
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d+))?(\/[^\s]*)?$/i;

let mostra: ((url: string) => void) | null = null;

/** Link tocado numa resposta: pergunta se abre no navegador do app ou no do sistema. */
export function abreLink(url: string) {
  if (mostra) mostra(url);
  else Linking.openURL(url);
}

/** Nome do servidor (como o Sites o chama) que atende a porta, ou null se nenhum roda nela. */
async function servidorDaPorta(porta: string): Promise<string | null> {
  const r = await api.get<{ servers: Servidor[]; detectados?: { port: number }[] }>("/servers");
  const nosso = r.servers.find((x) => x.alive && x.url && x.url.replace(/\/$/, "").endsWith(`:${porta}`));
  if (nosso) return nosso.name;
  return (r.detectados ?? []).some((d) => String(d.port) === porta) ? `porta-${porta}` : null;
}

type Aberto = { titulo: string; nome?: string; caminho?: string; direto?: string };

/** Montado uma vez na raiz: o diálogo da escolha e o navegador do app em tela cheia. */
export function NavegadorDoApp() {
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const inset = useSafeAreaInsets();

  useEffect(() => {
    mostra = (url) => {
      const local = LOCAL.exec(url);
      const alvo = async (): Promise<Aberto | null> => {
        if (!local) return { titulo: url, direto: url };
        const nome = await servidorDaPorta(local[1] ?? "80").catch(() => null);
        if (!nome) {
          pergunta("Abrir link", `Nenhum servidor está rodando na porta ${local[1] ?? "80"} do PC agora.`, [{ texto: "Ok" }]);
          return null;
        }
        return { titulo: nome, nome, caminho: local[2] ?? "" };
      };
      pergunta("Abrir link", url, [
        { texto: "Cancelar", estilo: "cancelar" },
        { texto: "Navegador do sistema", acao: async () => {
          const a = await alvo();
          if (!a) return;
          if (a.direto) return void Linking.openURL(a.direto);
          try { // o endereço que o PC publica para este celular (LAN ou tailnet)
            const r = await api.post<{ url: string }>(`/mobile/expose/${encodeURIComponent(a.nome!)}`);
            Linking.openURL(r.url + (a.caminho ?? ""));
          } catch (e: any) { pergunta("Abrir link", e.message, [{ texto: "Ok" }]); }
        } },
        { texto: "No app", acao: async () => { const a = await alvo(); if (a) setAberto(a); } },
      ]);
    };
    return () => { mostra = null; };
  }, []);

  if (!aberto) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={() => setAberto(null)} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: inset.top }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, height: 52 }}>
          <Pressable onPress={() => setAberto(null)} hitSlop={8} style={{ padding: 6 }}><Voltar size={20} /></Pressable>
          <Text style={[s.txt, { flex: 1, fontWeight: "600" }]} numberOfLines={1}>{aberto.titulo}</Text>
        </View>
        <Site nome={aberto.nome ?? ""} caminho={aberto.caminho} direto={aberto.direto} />
      </View>
    </Modal>
  );
}
