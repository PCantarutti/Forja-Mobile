@AGENTS.md

## Celular e PC sempre em sincronia, ao vivo

Toda mudança de estado feita no celular tem que aparecer no Forja Desktop na hora, e vice-versa, sem
recarregar. Exemplos: conversa nova no celular surge na barra lateral do PC em ~1 s; turno disparado no PC
aparece e faz stream na conversa aberta aqui (`Chat.tsx`, olhando o `/api/activity`).

O sinal é o `GET /api/activity` do backend do PC (id do último turno por conversa, carimbo da lista,
modelo local): tela que mostra estado compartilhado consulta ele e recarrega quando o valor muda. Feature que
mexe em estado compartilhado só está pronta depois de testada nos dois sentidos, no celular de verdade (adb)
e na instância real do desktop.
