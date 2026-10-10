import { GAME_TITLE } from '../config';
import type { DuelResultPayload } from '../duel/duel';
import type { DuelInfo } from '../game/gameSession';
import { MAX_ROUND_SCORE } from '../game/scoring';
import { h } from '../utils/dom';
import { formatScore } from '../utils/format';

export interface DuelResultScreenOptions {
  onPlay: () => void;
  onExit: () => void;
}

const REGION_TITLES: Record<string, string> = { russia: 'Вся Россия' };

/**
 * Экран сравнения дуэли: результат соперника из ссылки + ваш результат
 * из localStorage (если вы уже играли эту дуэль).
 */
export function renderDuelResultScreen(
  root: HTMLElement,
  data: { duel: DuelInfo; opponent: DuelResultPayload; own: DuelResultPayload | null },
  options: DuelResultScreenOptions,
): () => void {
  const { duel, opponent, own } = data;
  const regionTitle = REGION_TITLES[duel.region] ?? duel.region;

  const scoreBar = (score: number, color: 'you' | 'opp') =>
    h('div', { class: `vs-bar vs-bar-${color}` },
      h('span', { style: `width:${Math.max(2, (score / MAX_ROUND_SCORE) * 100)}%` }));

  const roundRows = opponent.r.map(([, oppScore], i) => {
    const ownScore = own?.r[i]?.[1];
    return h('div', { class: 'vs-round' },
      h('div', { class: 'vs-round-head' },
        h('span', {}, `Раунд ${i + 1}`),
        h('span', { class: 'vs-round-scores' },
          own && ownScore !== undefined
            ? `${formatScore(ownScore)} / ${formatScore(oppScore)}`
            : formatScore(oppScore))),
      h('div', { class: 'vs-bars' },
        ...(own && ownScore !== undefined ? [scoreBar(ownScore, 'you')] : []),
        scoreBar(oppScore, 'opp')),
    );
  });

  const playBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button' },
    own ? 'Сыграть дуэль ещё раз' : 'Сыграть эту дуэль');
  const exitBtn = h('button', { class: 'btn btn-secondary btn-lg', type: 'button' }, 'В меню');
  playBtn.addEventListener('click', options.onPlay);
  exitBtn.addEventListener('click', options.onExit);

  const children: (HTMLElement | string)[] = [
    h('div', { class: 'logo' }, h('span', { class: 'logo-pin' }), GAME_TITLE),
    h('h1', { class: 'final-title' }, 'Дуэль'),
    h('div', { class: 'final-city' }, `${regionTitle} · сид ${duel.seed}`),
  ];

  if (own) {
    const diff = own.t - opponent.t;
    const bannerText = diff > 0 ? 'Победа!' : diff < 0 ? 'Соперник оказался сильнее' : 'Ничья!';
    const bannerClass = diff > 0 ? 'vs-win' : diff < 0 ? 'vs-lose' : 'vs-draw';
    children.push(
      h('div', { class: `vs-banner ${bannerClass}` }, bannerText),
      h('div', { class: 'vs-cards' },
        h('div', { class: 'vs-card' },
          h('span', { class: 'vs-card-label' }, 'Вы'),
          h('span', { class: 'vs-card-score vs-you' }, formatScore(own.t))),
        h('div', { class: 'vs-card' },
          h('span', { class: 'vs-card-label' }, 'Соперник'),
          h('span', { class: 'vs-card-score vs-opp' }, formatScore(opponent.t))),
      ),
      h('div', { class: 'legend' },
        h('span', {}, h('i', { class: 'dot dot-you' }), 'Вы'),
        h('span', {}, h('i', { class: 'dot dot-opp' }), 'Соперник')),
    );
  } else {
    children.push(
      h('div', { class: 'vs-cards' },
        h('div', { class: 'vs-card' },
          h('span', { class: 'vs-card-label' }, 'Соперник'),
          h('span', { class: 'vs-card-score vs-opp' }, formatScore(opponent.t)))),
      h('p', { class: 'muted vs-note' },
        'Вы ещё не играли эту дуэль. Сыграйте — и здесь появится сравнение счёта.'),
    );
  }

  children.push(
    h('div', { class: 'vs-rounds' }, ...roundRows),
    h('div', { class: 'final-actions' }, playBtn, exitBtn),
  );

  const screen = h('div', { class: 'screen final' }, h('div', { class: 'final-card' }, ...children));
  root.replaceChildren(screen);
  playBtn.focus();
  return () => screen.remove();
}
