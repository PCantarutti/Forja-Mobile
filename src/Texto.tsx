import { createContext, useContext } from "react";
import { Text as T, TextInput as TI, type TextInputProps, type TextProps } from "react-native";
import { sans } from "./tema";

// Text e TextInput com a fonte do app (Configurações › Tema). O RN não tem fonte padrão global: todas as telas
// importam daqui. Texto aninhado herda a do pai (um trecho mono dentro de um parágrafo continua mono).
const Dentro = createContext(false);

export function Text(p: TextProps) {
  const dentro = useContext(Dentro);
  const t = <T {...p} style={dentro || !sans ? p.style : [{ fontFamily: sans }, p.style]} />;
  return dentro ? t : <Dentro.Provider value>{t}</Dentro.Provider>;
}
export type Text = T;

export function TextInput(p: TextInputProps & { ref?: React.Ref<TI> }) {
  return <TI {...p} style={sans ? [{ fontFamily: sans }, p.style] : p.style} />;
}
export type TextInput = TI;
