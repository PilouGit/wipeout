import './styles.css';
import { Game } from './game/Game';

const canvas = document.getElementById('c') as HTMLCanvasElement;

try {
  new Game(canvas).run();
} catch (err) {
  console.error(err);
  const box = document.getElementById('err');
  if (box) box.style.display = 'flex';
}
