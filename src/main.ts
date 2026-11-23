import './styles.css';
import { Game } from './game/Game';

const canvas = document.getElementById('c') as HTMLCanvasElement;

try {
  const game = new Game(canvas);
  // en développement : accès console / sondes de test (absent du build de production)
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  game.run();
} catch (err) {
  console.error(err);
  const box = document.getElementById('err');
  if (box) box.style.display = 'flex';
}
