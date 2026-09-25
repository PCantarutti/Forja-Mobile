import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { api } from "./api";
import { Globo } from "./icones";
import { c, mono, s } from "./tema";

export type Servidor = { name: string; alive: boolean; url: string; conv?: string; command?: string };

// Modo Desktop: o site recebe o user-agent do Chrome de desktop e uma viewport de 1280px, e a WebView
// encolhe a página para caber na tela. Deitando o celular, é o mesmo layout que o navegador do PC mostra.
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const VIEWPORT_DESKTOP = `(function () {
  function fixa() {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; (document.head || document.documentElement).appendChild(m); }
    // initial-scale explícito: só width=1280 a WebView abria ampliada num canto da página.
    var escala = Math.min(1, (screen.width || window.innerWidth) / 1280);
    m.content = 'width=1280, initial-scale=' + escala + ', minimum-scale=' + escala + ', user-scalable=yes';
  }
  fixa();
  document.addEventListener('DOMContentLoaded', fixa);
})(); true;`;

/** Site que o agente subiu, aberto pela tailnet: o backend publica a porta (`tailscale serve`) e devolve a URL. */
/** `direto`: um endereço qualquer (link de fora que a IA mandou), aberto como está, sem publicar porta. */
export default function Site({ nome, caminho = "", direto }: { nome: string; caminho?: string; direto?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null); // página atual: sobrevive à troca de modo
  const atual = useRef<string | null>(null);
  const [erro, setErro] = useState("");
  const [desktop, setDesktop] = useState(false);
  const web = useRef<WebView>(null);
  const { width, height } = useWindowDimensions();
  const deitado = width > height;

  useEffect(() => {
    setUrl(null);
    setErro("");
    if (direto) return void (setUrl(direto), setSrc(direto));
    api.post<{ url: string }>(`/mobile/expose/${encodeURIComponent(nome)}`)
      .then((r) => { setUrl(r.url); setSrc(r.url + caminho); })
      .catch((e) => setErro(e.message));
  }, [nome, direto]);

  if (erro) return <Text style={[s.muted, { color: c.red, padding: 16 }]}>{erro}</Text>;
  if (!url || !src) return <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator color={c.muted} /></View>;

  const barra = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 12, paddingVertical: 7,
                   borderBottomColor: c.line, borderBottomWidth: 1, backgroundColor: c.side }}>
      <Globo size={14} color={c.faint} />
      <Text style={{ flex: 1, color: c.muted, fontFamily: mono, fontSize: 12 }} numberOfLines={1}>{url}</Text>
      <Pressable hitSlop={8} onPress={() => { if (atual.current) setSrc(atual.current); setDesktop(!desktop); }}
                 style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: desktop ? c.fg : c.raised }}>
        <Text style={{ color: desktop ? "#000" : c.muted, fontSize: 12.5 }}>Desktop</Text>
      </Pressable>
      <Pressable hitSlop={8} onPress={() => web.current?.reload()}><Text style={s.muted}>Recarregar</Text></Pressable>
      <Pressable hitSlop={8} onPress={() => Linking.openURL(atual.current ?? src)}><Text style={s.muted}>Abrir fora</Text></Pressable>
    </View>
  );
  const pagina = (
    <WebView
      key={desktop ? "desktop" : "mobile"} // trocar o modo recarrega com o user-agent e a viewport novos
      ref={web}
      source={{ uri: src }}
      onNavigationStateChange={(e) => { atual.current = e.url; }}
      style={{ flex: 1, backgroundColor: "#fff" }}
      // Medido no A54 (gfxinfo, pomodoro com blur animado): 17% de quadros travados com a camada de hardware,
      // 34% sem ela. O resto é custo do CSS do próprio site.
      androidLayerType="hardware"
      userAgent={desktop ? UA_DESKTOP : undefined}
      injectedJavaScriptBeforeContentLoaded={desktop ? VIEWPORT_DESKTOP : undefined}
      scalesPageToFit
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      startInLoadingState
      renderLoading={() => <ActivityIndicator style={{ flex: 1 }} color={c.muted} />}
      onError={(e) => setErro(`Não abriu ${url}: ${e.nativeEvent.description}`)}
      onHttpError={(e) => e.nativeEvent.statusCode >= 500 && setErro(`${url} respondeu ${e.nativeEvent.statusCode}`)}
    />
  );

  // Mesma árvore em pé e deitado: trocar de contêiner remontava a WebView e o site recarregava do zero.
  // Deitado, quem some é o resto do app (cabeçalho, abas, caixa de prompt), e a barra do site fica fina.
  return <View style={{ flex: 1 }}>{!deitado && barra}{pagina}</View>;
}
