# Hyperglide

Course anti-gravité dans le navigateur — TypeScript, Three.js, Vite.

```bash
npm install
npm run dev        # serveur de dev avec rechargement à chaud
npm test           # tests de la simulation (sans navigateur)
npm run build      # vérification des types + build de prod dans dist/
```

## Architecture

La simulation (`track/`, `race/`) ne dépend ni du DOM ni du rendu : elle tourne telle quelle dans Node, ce qui permet de tester une course complète dans `tests/`. Le rendu, l'audio et l'interface s'y abonnent via les événements de `Race`.

```
src/
  config.ts          constantes de gameplay, difficultés, grille de départ
  main.ts            point d'entrée
  core/              utilitaires sans dépendance : maths, bus d'événements, entrées clavier/manette
  track/             spline et repères (s, x) → monde, zones (loopings, tunnels), constructeur de tracés, les 4 circuits
  race/              simulation pure : Ship, physique, IA, armes, pads, écuries (teams.ts), Race (machine à états + événements)
  render/            Three.js : scène/bloom, piste et tunnels, décors par circuit, vaisseaux (une silhouette par écurie), armes, particules, caméra
  audio/
    AudioEngine.ts   point d'entrée : contexte, volume, musique + moteur spatial
    spatial/         moteur audio procédural 3D (voir « Audio spatial »)
    imuse/           pilote de musique interactive façon iMUSE (sans dépendance au jeu)
    score/           la bande-son : notation, thème « Neon Ridge », jingles, identifiants
  ui/                HUD, mini-carte, écrans menu/pause/résultats
  game/SoundStage.ts pont course → audio (sources, auditeur, évènements → bruitages)
  game/Game.ts       chef d'orchestre : boucle à pas fixe, câblage simulation ↔ rendu ↔ audio ↔ UI
tests/               vitest : géométrie de la piste, compte à rebours, courses IA complètes, physique
```

## Circuits et écuries

| Circuit | Ambiance | Figures |
|---|---|---|
| Neon Ridge | mégapole, nuit | tunnel, dénivelé |
| Glacier Vault | haute montagne | looping, long tunnel |
| Magma Rift | île volcanique | tire-bouchon, looping, tunnel |
| Selene Orbital | base lunaire | looping, tire-bouchon, 2 tunnels |

Les tracés sont écrits avec `LayoutBuilder` (`.to()`, `.loop()`, `.corkscrew()`, `.tunnel()`). Dans une zone *magnétique* (looping, tire-bouchon), la normale de la piste pointe vers l'axe de la figure : le vaisseau reste plaqué et la piste le guide (pas de lacet à compenser). Hors figures, le repère suit la verticale du monde et s'incline dans les virages.

Huit écuries, sur le modèle de sélection de Wipeout Fusion : chacune a ses notes de 1 à 10 en vitesse, poussée, maniabilité, bouclier, armement et masse, converties en physique par `performance()` dans `race/teams.ts` (vitesse de pointe, accélération, lacet, adhérence, freinage, dégâts subis/infligés, poids dans les contacts). Les adversaires reçoivent les autres écuries, tirées au sort.

## Musique interactive

La musique suit les principes d'iMUSE ([document technique](https://github.com/meshula/LabMidi/blob/main/LabMuse/imuse-technical.md)) : le jeu ne coupe jamais la musique, il exprime des souhaits et la partition décide quand ils sont musicalement possibles.

- **Hooks** écrits dans la partition, évalués quand la lecture les atteint, actifs seulement si le jeu a posé la valeur correspondante : sauts de section en fin de phrase (`jump`), orchestration toutes les 2 mesures (`layer` 1–4), alarme bouclier faible (`tension`), modulation d'un ton avant le dernier tour.
- **Marqueurs + triggers** : à l'arrivée, le jeu demande l'outro et accroche le jingle de victoire ou de défaite au marqueur de fin d'outro ; il démarre pile sur la mesure.
- **Fondus entiers à 60 Hz** (Bresenham, comme `FdFade`), **commandes différées**, **groupes de volume**, **compteur de pause imbriqué**, **priorités**, **vitesse** (128 = tempo d'origine, accélère au dernier tour), **contrôleurs MIDI** (la brillance des synthés suit la vitesse).

- **Un thème par circuit** : Neon Ridge est écrit à la main ; les autres circuits sont générés à partir d'une graine fixe et d'un style (`audio/score/generator.ts` : tonalité, mode, tempo, progression, batterie, basse acide, mélodie, timbres). Tous partagent la même architecture de sections et de hooks (`audio/score/compose.ts`). `?musique=1234` régénère tous les thèmes à partir de cette graine, `?musique=aleatoire` en tire une au hasard. La mélodie générée est composée comme une phrase : un motif d'une mesure, répété, varié puis contrasté (A A′ B cadence | A A″ C cadence sur la sensible), les temps forts sur les notes de l'accord. Le panneau **F2** (section MUSIQUE) permet d'écouter d'autres graines pour le circuit affiché, en pleine course, avant d'en reporter une dans `audio/score/themes.ts`.
- **Dragons** : le décor écoute la musique (les dragons jaillissent sur les drops, battent des ailes sur les médiums, crachent le feu sur les aigus) et la musique leur répond : tant qu'ils sont hors du sol, le hook `dragon` fait entrer leur rugissement à la mesure suivante.

- **Mise en scène par section** (`render/music/Staging.ts`), à la manière d'une démo : chaque section est une scène avec sa dynamique (breakdown presque immobile, drop qui explose), les montées (FILL_UP, FILL_FINAL, fin d'intro et de breakdown) retiennent et assombrissent le décor, et chaque changement de section entendu (lu à l'heure audio) est une coupe nette : éclair, palette, motif du sol (spirale, anneaux, secteurs, houle), dragons sur le drop. En virage serré, le décor s'efface au profit de la piste, et les colonnes qui bordent la piste restent sobres.
- **Le rythme au pilotage** (`race/Groove.ts`) : la touche de rythme (**Maj**, **Y** à la manette, bouton **♪** au tactile) jouée sur le temps donne une impulsion qui grandit avec la série (jusqu'à ×8, bonus sur le premier temps) ; à contretemps elle coûte un peu de vitesse et casse la série. Un speed pad franchi ou un atterrissage sur le temps rapporte aussi. L'appui est jugé à l'instant entendu (horloge audio moins la latence de sortie), le HUD bat la mesure, et la série nourrit l'intensité de la musique.
- **Performances** : la qualité baisse d'elle-même par paliers si le jeu passe sous ~45 images/s (ciel allégé et planètes sans atmosphère, puis bloom à demi-résolution, puis définition réduite) ; `?qualite=max` l'en empêche, `?perf` affiche images/s, pire image, palier et notes de musique par seconde.

`game/MusicDirector.ts` traduit l'état de la course (vitesse, rang, adversaires proches, perte d'élan, dernier tour, touché, arrivée) en commandes iMUSE. Tout est synthétisé en Web Audio, sans fichier audio. Le moteur est testé sans navigateur via une sortie factice (`tests/imuse.test.ts`, `tests/soundtrack.test.ts`).

Positions : chaque vaisseau vit dans le repère de la piste — `s` distance parcourue (cumulée sur les tours), `x` décalage latéral, `psi` cap relatif à la piste. La physique avance à pas fixe (120 Hz).

## Audio spatial et acoustique des circuits

Tout est synthétisé en Web Audio natif, sans fichier ni dépendance. Le code est dans `src/audio/spatial/` :

| Fichier | Rôle |
|---|---|
| `AcousticWorld.ts` | Géométrie pure (testable sous Node). Sondes gauche / droite / haut par **sources images**, poteaux traités en diffuseurs ponctuels, enfermement (0 % à l'air libre, 100 % sous tunnel, rampe de 25 m aux portails), **occlusion** par échantillonnage du segment source → auditeur (roche autour des tunnels, tablier de la piste), Doppler. |
| `EngineVoice.ts` | Voix moteur d'un vaisseau. Dent de scie + triangle → passe-bas résonant → WaveShaper, plus une turbine (bruit passe-bande) et le souffle des aérofreins. Chemin direct : filtre d'occlusion → PannerNode HRTF. `ReflectionNetwork` : par paroi, DelayNode (2 à 40 ms) → passe-bas d'absorption → gain → PannerNode au point d'impact. |
| `Sfx.ts` | Bruitages : speed pad (souffle montant + écho), plasma, missile, collision métallique (résonateurs inharmoniques), frottement, alerte bouclier (double bip à 1760 Hz), explosion, jingles. |
| `dsp.ts` | Bruit blanc, courbe de saturation, réponse impulsionnelle de tunnel procédurale. |
| `WipeoutAudioEngine.ts` | Orchestrateur. Bus moteurs (ducking de 20 % sur tir ou alerte), bus bruitages, réverbération à convolution dont l'envoi suit l'enfermement de chaque source et dont le retour reçoit un renfort de graves sous tunnel, Doppler lissé, interrupteurs, données de débogage. |

Ce que l'on entend :
- **En rasant un mur**, la réflexion latérale tombe à 3 ou 4 ms, d'où un slapback et un filtrage en peigne qui varie avec la distance au mur.
- **Le long d'une colonnade**, une impulsion par pilier tous les 12 m, d'où un flutter echo.
- **Sous un tunnel**, le plafond s'ajoute aux réflexions et la queue de réverbération longue apparaît.
- **Un concurrent dans un tunnel, entendu du dehors**, n'est perçu qu'étouffé.

**Banc d'essai : F2.** Le panneau permet de couper chaque effet pour comparer, de piloter vitesse et aérofreins à la main (même au menu), et de déclencher chaque bruitage. Il affiche un radar vu de dessus des rayons réfléchis et, dans la scène, les rayons en 3D : cyan pour le mur gauche, rose pour le mur droit, jaune pour le plafond, vert pour les poteaux.

### Brancher le moteur sur une boucle de jeu

```ts
import { WipeoutAudioEngine, type SourceState } from './audio/spatial/WipeoutAudioEngine';

const ctx = new AudioContext();                 // après un geste utilisateur
const sfx = new WipeoutAudioEngine(ctx, ctx.destination);

function frame(dt: number) {
  sfx.update({
    track,                                       // Track : sert aux sondes, à l'enfermement et à l'occlusion
    dt,
    listener: { position: cam.position, forward: camForward, up: camUp, s: player.s },
    sources: ships.map((ship, id): SourceState => ({
      id, isPlayer: ship.isPlayer, active: !ship.dead,
      s: ship.s, x: ship.x, lift: 1.15,          // repère piste : abscisse, décalage latéral, hauteur
      position: ship.worldPosition,              // monde
      velocity: ship.worldVelocity,              // m/s monde, pour le Doppler
      speed: ship.speed / ship.vmax,             // 0..1
      thrust: ship.thrust, airbrake: ship.airbrake,
    })),
  });
}

// évènements : positionné (HRTF + réverbération du lieu) ou « dans le casque »
sfx.play('speedPad', { position, s });
sfx.play('collision', { position, s }, impact01);
sfx.play('shieldAlert');                        // déclenche aussi le ducking des moteurs
sfx.options.reflections = false;                // reverb, doppler, occlusion
```

Dans le jeu, c'est `src/game/SoundStage.ts` qui fait ce travail à partir de `Race`.

Pour le coût CPU, chaque voix compte un panner HRTF sur le son direct et cinq lignes de réflexion. Les réflexions des concurrents utilisent un panoramique égal-puissance, moins coûteux, et une voix au-delà de 350 m est coupée.

## Sur téléphone

```bash
npm run dev:mobile      # ouvre le serveur au réseau local
```
Le téléphone doit être sur le même Wi-Fi que l'ordinateur. Ouvrez ensuite l'adresse « Network » affichée (par exemple `http://192.168.1.20:5173`), en paysage. Si le téléphone n'arrive pas à se connecter, le pare-feu Windows bloque probablement Node : autorisez-le sur les réseaux privés.

**Commandes tactiles**, affichées automatiquement quand le pointeur principal est un écran tactile :
- **Moitié gauche de l'écran : stick flottant.** Posez le pouce n'importe où, puis glissez à gauche ou à droite pour diriger.
- **À droite :**
  - les aérofreins ◀ AÉRO et AÉRO ▶ ;
  - FREIN, à maintenir pour freiner (l'accélération est automatique) ;
  - ARME, qui affiche l'arme ramassée.
- **En haut, au centre :** la pause.

Le HUD passe en version compacte pour ne rien laisser sous les pouces. La course se met en pause si l'application passe en arrière-plan ou si l'on tourne l'écran en portrait. Au lancement d'une course, le jeu passe en plein écran et en paysage sur Android ; sur iPhone, un message invite à tourner l'appareil.

**Qualité allégée**, activée par défaut sur mobile :
- **Rendu :** pas d'antialiasing, définition 1×, bloom calculé à demi-résolution.
- **Audio :** HRTF et réflexions réservés au joueur, panoramique simple pour les concurrents et les bruitages, réverbération courte.

**Options dans l'URL :**
- `?touch` : commandes tactiles sur ordinateur, pour tester ;
- `?lite` : qualité allégée ;
- `?full` : qualité complète, même sur mobile.

Sur iPhone, le bouton silencieux coupe aussi le son du jeu : c'est une règle de Safari.
