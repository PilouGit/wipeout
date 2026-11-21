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
