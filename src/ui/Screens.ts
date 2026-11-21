import type { DifficultyKey } from '../config';
import type { ResultRow } from '../race/Race';
import type { Team, TeamStats } from '../race/teams';
import type { Circuit } from '../track/circuits';
import { byId } from './dom';
import { formatTime, hexColor } from './format';

export interface MenuSelection {
  readonly circuit: string;
  readonly team: string;
  readonly difficulty: DifficultyKey;
}

export interface ScreenHandlers {
  onStart(): void;
  onResume(): void;
  onMenu(): void;
  onDifficulty(key: DifficultyKey): void;
  onCircuit(id: string): void;
  onTeam(id: string): void;
}

export interface ResultsView {
  readonly title: string;
  readonly rows: readonly ResultRow[];
  readonly lapTimes: readonly number[];
}

const STAT_LABELS: readonly (readonly [keyof TeamStats, string])[] = [
  ['speed', 'VITESSE'], ['thrust', 'POUSSÉE'], ['handling', 'MANIABILITÉ'], ['shield', 'BOUCLIER'], ['weapon', 'ARMEMENT'], ['mass', 'MASSE'],
];

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Écrans plein écran : titre (choix circuit / écurie / difficulté), pause, résultats. */
export class Screens {
  private readonly menu = byId('menu');
  private readonly pause = byId('pause');
  private readonly results = byId('results');

  constructor(
    handlers: ScreenHandlers,
    private readonly circuits: readonly Circuit[],
    private readonly teams: readonly Team[],
    initial: MenuSelection,
  ) {
    this.buildCircuitPicker(handlers);
    this.buildTeamPicker(handlers);
    const diffButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-d]')];
    for (const btn of diffButtons) {
      btn.classList.toggle('sel', btn.dataset.d === initial.difficulty);
      btn.addEventListener('click', () => {
        diffButtons.forEach((b) => b.classList.toggle('sel', b === btn));
        handlers.onDifficulty(btn.dataset.d as DifficultyKey);
      });
    }
    this.selectCircuit(initial.circuit);
    this.selectTeam(initial.team);
    byId('startBtn').onclick = handlers.onStart;
    byId('againBtn').onclick = handlers.onStart;
    byId('restartBtn').onclick = handlers.onStart;
    byId('resumeBtn').onclick = handlers.onResume;
    byId('menuBtn').onclick = handlers.onMenu;
    byId('menuBtn2').onclick = handlers.onMenu;
  }

  private buildCircuitPicker(handlers: ScreenHandlers): void {
    const box = byId('circuits');
    box.innerHTML = this.circuits
      .map(
        (c) => `<button class="circuit" data-circuit="${c.id}">
          <span class="c-name">${escape(c.name)}</span>
          <span class="c-loc">${escape(c.location)}</span>
          <span class="c-tags">${c.features.map((f) => `<i>${escape(f)}</i>`).join('')}</span>
        </button>`,
      )
      .join('');
    box.querySelectorAll<HTMLButtonElement>('[data-circuit]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.selectCircuit(btn.dataset.circuit!);
        handlers.onCircuit(btn.dataset.circuit!);
      }),
    );
  }

  private buildTeamPicker(handlers: ScreenHandlers): void {
    const box = byId('teams');
    box.innerHTML = this.teams
      .map((t) => `<button class="team" data-team="${t.id}" style="--team:${hexColor(t.color)}"><span class="swatch"></span>${escape(t.name)}</button>`)
      .join('');
    box.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.selectTeam(btn.dataset.team!);
        handlers.onTeam(btn.dataset.team!);
      }),
    );
  }

  private selectCircuit(id: string): void {
    byId('circuits').querySelectorAll<HTMLElement>('[data-circuit]').forEach((b) => b.classList.toggle('sel', b.dataset.circuit === id));
  }

  private selectTeam(id: string): void {
    byId('teams').querySelectorAll<HTMLElement>('[data-team]').forEach((b) => b.classList.toggle('sel', b.dataset.team === id));
    const team = this.teams.find((t) => t.id === id);
    if (!team) return;
    const bars = STAT_LABELS.map(
      ([key, label]) =>
        `<span class="label">${label}</span><span class="stat"><span style="width:${team.stats[key] * 10}%;background:${hexColor(team.color)}"></span></span>`,
    ).join('');
    byId('teamInfo').innerHTML = `
      <div class="t-head"><b style="color:${hexColor(team.color)}">${escape(team.name)}</b> <span>${escape(team.ship)}</span></div>
      <div class="t-blurb">${escape(team.blurb)}</div>
      <div class="stats">${bars}</div>`;
  }

  showMenu(): void {
    this.hideAll();
    this.menu.style.display = 'flex';
  }

  showPause(visible: boolean): void {
    this.pause.style.display = visible ? 'flex' : 'none';
  }

  showResults(view: ResultsView): void {
    byId('resTitle').textContent = view.title;
    byId('resTable').innerHTML = view.rows
      .map((row, i) => {
        const time =
          row.status === 'eliminated' ? 'ÉLIMINÉ' : formatTime(row.time) + (row.status === 'estimated' ? '*' : '');
        const me = row.ship.isPlayer ? 'me' : '';
        const name = row.ship.name + (row.ship.isPlayer ? ' · TOI' : '');
        return `<tr class="${me}"><td>${i + 1}</td><td><span class="swatch" style="background:${hexColor(row.ship.color)}"></span>${name}</td><td>${time}</td></tr>`;
      })
      .join('');
    byId('resLaps').textContent = view.lapTimes.length
      ? `Tes tours : ${view.lapTimes.map(formatTime).join(' · ')}  —  Meilleur : ${formatTime(Math.min(...view.lapTimes))}`
      : '';
    this.results.style.display = 'flex';
  }

  hideAll(): void {
    this.menu.style.display = 'none';
    this.pause.style.display = 'none';
    this.results.style.display = 'none';
  }
}
