import type { GameSession } from '../game/gameSession';
import { MAX_ROUND_SCORE } from '../game/scoring';
import { copyText, h } from '../utils/dom';
import { formatDistance, formatScore, pluralizePoints } from '../utils/format';

export interface FinalScreenOptions {
  onReplay: () => void;
  onChangeCity: () => void;
  /** Дуэль: ссылки, чтобы отправить сопернику дуэль и сравнение результатов. */
  duel?: { shareLink: string; resultLink: string } | null;
}

function shareRow(label: string, link: string): HTMLElement {
  const input = h('input', {
    class: 'duel-link-input',
    type: 'text',
    readonly: true,
    'aria-label': label,
  });
  input.value = link;
  const btn = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Копировать');
  btn.addEventListener('click', async () => {
    if (await copyText(link)) {
      btn.textContent = 'Скопировано ✓';
      setTimeout(() => (btn.textContent = 'Копировать'), 1500);
    }
  });
  return h('div', { class: 'duel-link-row' },
    h('span', { class: 'duel-link-label' }, label),
    input,
    btn,
  );
}

export function renderFinalScreen(
  root: HTMLElement,
  session: GameSession,
  options: FinalScreenOptions,
): () => void {
  const total = session.totalScore;
  const percent = Math.round((total / session.maxTotalScore) * 100);

  const rows = session.results.map((r) =>
    h('li', { class: 'round-row' },
      h('span', { class: 'round-row-num' }, String(r.round)),
      h('span', { class: 'round-row-bar' },
        h('span', { style: `width:${(r.score / MAX_ROUND_SCORE) * 100}%` })),
      h('span', { class: 'round-row-dist' }, formatDistance(r.distance)),
      h('span', { class: 'round-row-score' }, formatScore(r.score)),
    ),
  );

  const replayBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button' },
    options.duel
      ? 'Сыграть дуэль ещё раз'
      : session.region.selection.kind === 'city'
        ? 'Сыграть ещё в этом же городе'
        : 'Сыграть ещё раз');
  const changeBtn = h('button', { class: 'btn btn-secondary btn-lg', type: 'button' },
    options.duel ? 'В меню' : 'Выбрать другой город');
  replayBtn.addEventListener('click', options.onReplay);
  changeBtn.addEventListener('click', options.onChangeCity);

  const duelShare = options.duel
    ? h('div', { class: 'duel-share' },
        h('div', { class: 'duel-share-title' }, 'Дуэль по ссылке'),
        shareRow('Ссылка на дуэль', options.duel.shareLink),
        shareRow('Ссылка с вашим результатом', options.duel.resultLink),
        h('p', { class: 'muted small' },
          'Соперник откроет ссылку с результатом и увидит сравнение счёта по раундам.'))
    : null;

  const screen = h('div', { class: 'screen final' },
    h('div', { class: 'final-card' },
      h('h1', { class: 'final-title' }, options.duel ? 'Результат дуэли' : 'Итоговый результат'),
      h('div', { class: 'final-city' }, session.region.title),
      h('div', { class: 'final-score' },
        h('span', { class: 'final-score-value' }, formatScore(total)),
        h('span', { class: 'final-score-max' }, ` / ${formatScore(session.maxTotalScore)} ${pluralizePoints(session.maxTotalScore)}`),
      ),
      h('div', { class: 'progress' }, h('span', { style: `width:${percent}%` })),
      h('div', { class: 'final-stats' },
        h('div', { class: 'stat' },
          h('span', { class: 'stat-label' }, 'Среднее расстояние'),
          h('span', { class: 'stat-value' }, formatDistance(session.averageDistance))),
        h('div', { class: 'stat' },
          h('span', { class: 'stat-label' }, 'Точность'),
          h('span', { class: 'stat-value' }, `${percent}%`)),
      ),
      h('ol', { class: 'round-list' }, ...rows),
      ...(duelShare ? [duelShare] : []),
      h('div', { class: 'final-actions' }, replayBtn, changeBtn),
    ),
  );

  root.replaceChildren(screen);
  replayBtn.focus();
  return () => screen.remove();
}
