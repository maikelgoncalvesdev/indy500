# Indy 500 — 3D

Releitura em 3D do velho Indy 500, feita com HTML, JavaScript e three.js.
Traçado no formato do Indianapolis Motor Speedway — retângulo arredondado com duas
retas longas (front/back stretch), quatro curvas de 90° e duas retas curtas (*short
chutes*) — com ~2 km de volta. Câmera atrás do carro, grid de 6 em fila dupla e 3
voltas. Você larga em último contra 5 CPUs.

## Como rodar

O jogo usa ES modules, então **precisa ser servido por HTTP** (abrir o `index.html`
direto pelo Explorer não funciona — o navegador bloqueia os módulos em `file://`).

```powershell
node serve.mjs
# abre http://localhost:5173
```

Qualquer outro servidor estático também serve (`npx serve`, `python -m http.server`, Live Server do VS Code).

O three.js vem de CDN (`cdn.jsdelivr.net`), então a primeira execução precisa de internet.

## Controles

| Tecla | Ação |
|---|---|
| `↑` / `W` | acelerar |
| `↓` / `S` | frear / ré |
| `←` `→` / `A` `D` | dirigir |
| `Espaço` | freio de mão |
| `C` | trocar câmera (perseguição / cabine / afastada) |
| `M` | ligar/desligar som |
| `R` | reiniciar a prova |

## Dicas de pilotagem

O carro chega a ~285 km/h nas retas, mas o equilíbrio nas curvas fica em torno de
215 km/h: curvar rouba velocidade. Levante o pé na entrada, faça a curva por dentro
e volte a acelerar na saída. Sair do asfalto para a grama derruba muito a velocidade,
e o muro tira mais da metade dela.

## Estrutura

```
index.html        markup + HUD + importmap do three.js
css/style.css     HUD (painéis, minimapa, telas de largada e resultado)
serve.mjs         servidor estático sem dependências
src/track.js      matemática do oval (posição/progresso/curvatura) + geometria da pista
src/car.js        modelo 3D do carro e física
src/ai.js         piloto da CPU (linha de corrida, limite de curva, ultrapassagem)
src/input.js      teclado
src/scenery.js    céu, chão, arquibancadas, boxes, pórtico, postes, árvores
src/hud.js        painéis e minimapa
src/audio.js      motor e efeitos sintetizados (sem arquivos de áudio)
src/main.js       montagem da cena, câmeras e regras da prova
```

## Ajustes rápidos

- Número de voltas: `LAPS` no topo de [src/main.js](src/main.js) (a volta tem ~2 km,
  então cada volta leva ~33 s — 3 voltas ≈ 1 min 40 de corrida)
- Formato e tamanho da pista: `TRACK` no topo de [src/track.js](src/track.js)
  (`longStraight`, `shortChute`, `radius`, `width`) — a geometria toda é derivada desses
  quatro números
- Grid: a lista `GRID` em [src/main.js](src/main.js) — cada linha é um carro (nome, cor e
  `skill`). Acrescente ou remova linhas para mudar o tamanho do pelotão; a posição do
  jogador no grid é a posição dele nessa lista. `skill` regula a velocidade de curva da
  CPU: 0.95 ≈ 17,6 s por volta, 0.83 ≈ 18,4 s
- Física do carro: `CAR_SPEC` em [src/car.js](src/car.js)
