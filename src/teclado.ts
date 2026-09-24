import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/** Altura do teclado aberto. Com edge-to-edge o Android não encolhe a janela (e o KeyboardAvoidingView
 * subia de menos): quem tem caixa de texto no rodapé sobe exatamente isso. */
export function useTeclado() {
  const [altura, setAltura] = useState(0);
  useEffect(() => {
    const a = Keyboard.addListener("keyboardDidShow", (e) => setAltura(e.endCoordinates.height));
    const b = Keyboard.addListener("keyboardDidHide", () => setAltura(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return altura;
}
