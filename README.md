# Indy — 3D

Releitura em 3D do velho Indy, feita com HTML, JavaScript e three.js.
Traçado no formato do Indianapolis Motor Speedway — retângulo arredondado com duas
retas longas (front/back stretch), quatro curvas de 90° e duas retas curtas (*short
chutes*) — com ~2 km de volta. Câmera atrás do carro e grid de 10 em fila dupla.
Você escolhe seu piloto entre 12 animais da fauna brasileira e o tamanho da prova
(3, 5 ou 10 voltas), larga em último e tem 9 CPUs pela frente.

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
| `H` | mostrar/ocultar o HUD |
| `G` | qualidade gráfica (alto / médio / baixo) |
| `R` | reiniciar a prova |
| `Enter` | largar / pausar |

Em telas de toque aparecem quatro botões na base (esquerda, direita, freio e gás).

## Dicas de pilotagem

O carro chega a ~285 km/h nas retas, mas o equilíbrio nas curvas fica em torno de
215 km/h: curvar rouba velocidade. Levante o pé na entrada, faça a curva por dentro
e volte a acelerar na saída. Sair do asfalto para a grama derruba muito a velocidade,
e o muro tira mais da metade dela.

A faixa escura de borracha no asfalto (o *groove*) marca a linha de corrida ideal:
ela abre para fora nas retas e fecha por dentro nas curvas. Seguir o groove é seguir
o traçado rápido.

## Qualidade gráfica

`G` alterna três níveis. Os dois passes caros são o **bloom** (reprocessa a tela
inteira várias vezes) e o **céu como fonte de luz** (`scene.environment`, que
custa samples por pixel em todo material). As sombras ficam ligadas nos três:
a luz rasante do fim de tarde é metade do visual e sai barata perto dos outros
dois.

| Nível | Bloom | Céu iluminando | Sombras | Resolução |
|---|---|---|---|---|
| alto | sim | sim | 2048 | até 2× |
| médio | não | sim | 1024 | até 1,5× |
| **rápido** (padrão) | não | não | 1024 | 1× |

No nível rápido a luz ambiente é reforçada para cobrir o que o céu deixa de
iluminar, então os karts ficam um pouco mais foscos, mas nada some. O bloom vem
dos addons do three.js pelo mesmo CDN — se o import falhar, o jogo simplesmente
renderiza sem ele.

## Estrutura

```
index.html        markup + HUD + importmap do three.js
css/style.css     HUD (painéis, tacômetro, minimapa, telas de largada e resultado)
serve.mjs         servidor estático sem dependências
src/track.js      matemática do oval (posição/progresso/curvatura), geometria e groove
src/car.js        modelo 3D do kart + piloto-animal e física
src/ai.js         piloto da CPU (linha de corrida, limite de curva, ultrapassagem)
src/input.js      teclado e botões de toque
src/scenery.js    céu, chão, arquibancadas, boxes, pit lane, torre de bandeirada, postes, mata
src/effects.js    fumaça de pneu, poeira, faíscas e marcas no asfalto
src/portraits.js  retratos 3D dos animais, gerados uma vez no boot para a interface
src/meshutil.js   fusão de geometrias por material (corta draw calls)
src/postfx.js     bloom opcional (addons do three, com fallback)
src/hud.js        painéis, tacômetro, minimapa, avisos e telas
src/audio.js      motor e efeitos sintetizados (sem arquivos de áudio)
src/main.js       montagem da cena, luz, câmeras e regras da prova
```

## Ajustes rápidos

- Tamanho da corrida: `LAP_OPTIONS` no topo de [src/main.js](src/main.js) — os
  valores viram os botões do menu, e o escolhido fica salvo no `localStorage`.
  A volta tem ~2 km e leva ~33 s, então 3 voltas ≈ 1 min 40 e 10 voltas ≈ 5 min 30
- Formato e tamanho da pista: `TRACK` no topo de [src/track.js](src/track.js)
  (`longStraight`, `shortChute`, `radius`, `width`) — a geometria toda é derivada desses
  quatro números
- Grid: `CPU_COUNT` e a lista `ANIMALS` em [src/main.js](src/main.js) — cada animal é um
  piloto (nome, cor, formato da cabeça). `skill` regula a velocidade de curva da CPU:
  0.95 ≈ 17,6 s por volta, 0.83 ≈ 18,4 s. O jogador larga sempre em último
- Física do carro: `CAR_SPEC` em [src/car.js](src/car.js)
- Hora do dia: `SUN_DIR` e o gradiente de `skyTexture()` em
  [src/scenery.js](src/scenery.js), mais a cor/intensidade do `sun` e o
  `toneMappingExposure` em [src/main.js](src/main.js)
- Linha de corrida (e portanto o desenho do groove e o traçado da CPU):
  `racingLineLat()` em [src/track.js](src/track.js)
- Pit lane: `PIT` em [src/track.js](src/track.js) — onde a bifurcação começa e
  termina (em metros a partir da linha de chegada), onde o muro divisor entra e
  sai, e o número de garagens. A largura acompanha `TRACK.width`; o apron e o
  muro interno abrem espaço para ela automaticamente

## Boxes

A pit lane é uma **bifurcação da pista principal**, com a mesma largura e o
mesmo asfalto, encostada nela — não um corredor à parte. No fim da reta o
asfalto abre a partir da própria pista; nas duas pontas as pistas se tocam, e é
por ali que se entra e se sai. No miolo, um muro divisor separa as duas, então
quem entrou fica do lado dos boxes até a saída.

Dirigir na pit lane não tem penalidade de superfície — não há pit stop, é só um
caminho alternativo e mais longo.

O contorno dessa faixa vem de uma função só, `pitBounds()` em
[src/track.js](src/track.js): ela desenha o asfalto, guia o muro externo e
limita o carro. Como as três coisas leem a mesma fonte, o asfalto que se vê é
exatamente o asfalto onde dá para dirigir.
