import { useRef, useState } from "react";
import { PanResponder, type GestureResponderEvent, type View } from "react-native";

// Pinça (zoom de 1 a 4×) e dois dedos (mover), para o editor de máscara e o visor de imagem.
// Um dedo vai para `umDedo` com o ponto já em coordenadas da camada sem zoom (0..largura, 0..altura).
// As contas usam pageX/pageY e a posição medida da camada: o locationX do Android vem relativo ao elemento
// tocado e dava deslocamento no traço.
export type Vista = { z: number; x: number; y: number };
type UmDedo = { inicio: (x: number, y: number) => void; move: (x: number, y: number) => void; fim: () => void; cancela?: () => void };

export function useGestos(tam: { w: number; h: number }, umDedo?: UmDedo | ((v: Vista) => UmDedo | undefined)) {
  const [vista, setVista] = useState<Vista>({ z: 1, x: 0, y: 0 });
  const caixa = useRef<View>(null); // a camada SEM transformação, onde o zoom é aplicado por dentro
  const st = useRef({ vista, tam, umDedo, origem: { x: 0, y: 0 }, pinca: null as null | { d: number; mx: number; my: number; v: Vista },
                      arrasto: null as null | { px: number; py: number; v: Vista }, dedo: false, pincou: false,
                      espera: null as null | { t0: number; pts: { x: number; y: number }[] } });
  // O traço só começa depois de ESPERA ms com um dedo só: o segundo dedo de uma pinça chega um instante depois
  // do primeiro, e sem isso ficava um ponto pintado onde a pinça começou.
  const ESPERA = 90;
  st.current.vista = vista;
  st.current.tam = tam;
  st.current.umDedo = umDedo;

  const mede = () => caixa.current?.measure((_x, _y, _w, _h, px, py) => { st.current.origem = { x: px, y: py }; });
  /** Ponto da tela → coordenada da camada sem zoom (a transformação é em torno do centro). */
  const local = (px: number, py: number) => {
    const { vista: v, tam: t, origem: o } = st.current;
    return { x: (px - o.x - t.w / 2 - v.x) / v.z + t.w / 2, y: (py - o.y - t.h / 2 - v.y) / v.z + t.h / 2 };
  };
  const limita = (v: Vista): Vista => {
    const z = Math.min(4, Math.max(1, v.z));
    if (z === 1) return { z: 1, x: 0, y: 0 };
    const { w, h } = st.current.tam;
    const mx = (w * (z - 1)) / 2, my = (h * (z - 1)) / 2; // não deixa a imagem sair inteira da área
    return { z, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  };
  const quem = (): UmDedo | undefined => {
    const u = st.current.umDedo;
    return typeof u === "function" ? u(st.current.vista) : u;
  };

  const resp = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e: GestureResponderEvent) => {
      mede();
      const { pageX, pageY } = e.nativeEvent;
      st.current.pincou = false;
      if (quem()) st.current.espera = { t0: Date.now(), pts: [local(pageX, pageY)] };
      else st.current.arrasto = { px: pageX, py: pageY, v: st.current.vista };
    },
    onPanResponderMove: (e: GestureResponderEvent) => {
      const toques = e.nativeEvent.touches;
      if (toques.length >= 2) {
        st.current.espera = null; // a pinça chegou antes de o traço começar: nada é pintado
        st.current.pincou = true; // e o pincel só volta quando todos os dedos saírem
        if (st.current.dedo) { st.current.dedo = false; const u = quem(); (u?.cancela ?? u?.fim)?.(); }
        const [a, b] = toques;
        const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), mx = (a.pageX + b.pageX) / 2, my = (a.pageY + b.pageY) / 2;
        const g = st.current.pinca ?? (st.current.pinca = { d, mx, my, v: st.current.vista });
        setVista(limita({ z: g.v.z * (d / Math.max(1, g.d)), x: g.v.x + (mx - g.mx), y: g.v.y + (my - g.my) }));
        return;
      }
      st.current.pinca = null;
      const { pageX, pageY } = e.nativeEvent;
      const esp = st.current.espera;
      if (esp) {
        esp.pts.push(local(pageX, pageY));
        if (Date.now() - esp.t0 < ESPERA) return;
        st.current.espera = null;
        const u = quem();
        if (u) { st.current.dedo = true; u.inicio(esp.pts[0].x, esp.pts[0].y); esp.pts.slice(1).forEach((p) => u.move(p.x, p.y)); }
        return;
      }
      if (st.current.pincou && quem()) return; // depois da pinça, um dedo que sobrou não pinta
      if (st.current.dedo) { const p = local(pageX, pageY); quem()?.move(p.x, p.y); return; }
      const ar = st.current.arrasto ?? (st.current.arrasto = { px: pageX, py: pageY, v: st.current.vista });
      if (st.current.vista.z > 1) setVista(limita({ ...ar.v, x: ar.v.x + pageX - ar.px, y: ar.v.y + pageY - ar.py }));
    },
    onPanResponderRelease: (e: GestureResponderEvent) => {
      const esp = st.current.espera;
      const u = quem();
      if (st.current.dedo && !st.current.pincou) { const p = local(e.nativeEvent.pageX, e.nativeEvent.pageY); u?.move(p.x, p.y); } // o ponto onde o dedo saiu
      if (esp && u) { u.inicio(esp.pts[0].x, esp.pts[0].y); esp.pts.slice(1).forEach((p) => u.move(p.x, p.y)); u.fim(); } // toque rápido: um ponto
      else if (st.current.dedo) u?.fim();
      st.current.dedo = false; st.current.pinca = null; st.current.arrasto = null; st.current.espera = null; st.current.pincou = false;
    },
    onPanResponderTerminate: () => {
      if (st.current.dedo) { const u = quem(); (u?.cancela ?? u?.fim)?.(); }
      st.current.dedo = false; st.current.pinca = null; st.current.arrasto = null; st.current.espera = null; st.current.pincou = false;
    },
  })).current;

  const zoom = (z: number) => setVista((v) => limita({ ...v, z }));
  return { vista, zoom, caixa, mede, handlers: resp.panHandlers };
}
