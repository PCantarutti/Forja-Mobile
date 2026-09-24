import Svg, { Circle, Path, Rect } from "react-native-svg";
import { c } from "./tema";

type P = { size?: number; color?: string };

// Traço no estilo dos ícones do desktop (frontend/src/components/icons.tsx): 24x24, stroke 2, pontas redondas.
function Icone({ size = 20, color = c.fg, children }: P & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const Voltar = (p: P) => <Icone {...p}><Path d="M15 18l-6-6 6-6" /></Icone>;
export const Seta = (p: P) => <Icone {...p}><Path d="M9 18l6-6-6-6" /></Icone>;
export const Abaixo = (p: P) => <Icone {...p}><Path d="M6 9l6 6 6-6" /></Icone>;
export const Enviar = (p: P) => <Icone {...p}><Path d="M12 19V5M5 12l7-7 7 7" /></Icone>;
export const Parar = ({ size = 20, color = c.fg }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x={6} y={6} width={12} height={12} rx={2} fill={color} /></Svg>
);
export const Busca = (p: P) => <Icone {...p}><Circle cx={11} cy={11} r={7} /><Path d="M21 21l-4.3-4.3" /></Icone>;
export const Globo = (p: P) => (
  <Icone {...p}><Circle cx={12} cy={12} r={9} /><Path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></Icone>
);
export const Cubo = (p: P) => (
  <Icone {...p}><Path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" /></Icone>
);
export const Relogio = (p: P) => <Icone {...p}><Circle cx={12} cy={12} r={9} /><Path d="M12 7v5l3 2" /></Icone>;
export const Escudo = (p: P) => <Icone {...p}><Path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /></Icone>;
export const Cerebro = (p: P) => (
  <Icone {...p}><Path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V7a3 3 0 00-3-3zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0" /></Icone>
);
export const Sair = (p: P) => <Icone {...p}><Path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /></Icone>;
export const Balao = (p: P) => <Icone {...p}><Path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /></Icone>;
export const Menu = (p: P) => <Icone {...p}><Path d="M4 8h16M4 16h10" /></Icone>;
export const Novo = (p: P) => <Icone {...p}><Path d="M12 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-6M18.4 2.6a2 2 0 013 3L12 15l-4 1 1-4 9.4-9.4z" /></Icone>;
export const Codigo = (p: P) => <Icone {...p}><Path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></Icone>;
export const Divide = (p: P) => <Icone {...p}><Path d="M16 3h5v5M8 3H3v5M21 3l-7.5 7.5M3 3l7.5 7.5M12 12v9" /></Icone>;
export const Pasta = (p: P) => <Icone {...p}><Path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></Icone>;
export const Filme = (p: P) => <Icone {...p}><Rect x={2} y={5} width={15} height={14} rx={2} /><Path d="M17 10l5-3v10l-5-3z" /></Icone>;
export const Imagem = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={16} rx={2} /><Circle cx={9} cy={10} r={2} /><Path d="M21 16l-5-5-9 9" /></Icone>;
export const Balanca = (p: P) => <Icone {...p}><Path d="M12 3v18M5 21h14M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7" /></Icone>;
export const Info = (p: P) => <Icone {...p}><Circle cx={12} cy={12} r={9} /><Path d="M12 11v5M12 8h.01" /></Icone>;
export const Term = (p: P) => <Icone {...p}><Path d="M4 17l6-5-6-5M12 19h8" /></Icone>;
export const Ramo = (p: P) => <Icone {...p}><Circle cx={6} cy={5} r={2} /><Circle cx={6} cy={19} r={2} /><Circle cx={18} cy={7} r={2} /><Path d="M6 7v10M18 9a6 6 0 01-6 6H6" /></Icone>;
export const Pulso = (p: P) => <Icone {...p}><Path d="M3 12h4l3-8 4 16 3-8h4" /></Icone>;
export const Chip = (p: P) => <Icone {...p}><Rect x={6} y={6} width={12} height={12} rx={2} /><Path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></Icone>;
export const Prancheta = (p: P) => <Icone {...p}><Rect x={5} y={4} width={14} height={17} rx={2} /><Path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4" /></Icone>;
export const PainelDir = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={16} rx={2} /><Path d="M15 4v16" /></Icone>;
export const Acima = (p: P) => <Icone {...p}><Path d="M6 15l6-6 6 6" /></Icone>;
