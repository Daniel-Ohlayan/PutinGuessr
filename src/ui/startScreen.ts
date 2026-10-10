import { CITY_LIST, searchCities, type CityListItem } from '../data/cities';
import { absoluteHashUrl, buildDuelHash, DUEL_REGION, parseDuelInput } from '../duel/duel';
import type { DuelInfo } from '../game/gameSession';
import type { RegionSelection } from '../game/region';
import { GAME_SUBTITLE, GAME_TITLE } from '../config';
import { copyText, h, show } from '../utils/dom';
import { randomSeed } from '../utils/random';

type Mode = 'city' | 'russia' | 'duel';

export interface StartScreenOptions {
  selectedId?: string | null;
  mode?: 'city' | 'russia';
  onPlay: (selection: RegionSelection) => void;
  onJoinDuel: (duel: DuelInfo) => void;
}

const LIST_LIMIT = 80;

function formatPopulation(n: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} млн`;
  if (n >= 1000) return `${Math.round(n / 1000)} тыс.`;
  return String(n);
}

export function renderStartScreen(root: HTMLElement, options: StartScreenOptions): () => void {
  let selectedId: string | null = options.selectedId ?? null;
  let mode: Mode = options.mode ?? 'city';

  // ---------- Вкладки ----------
  const tabCity = h('button', { class: 'tab', type: 'button' }, 'Один город');
  const tabRussia = h('button', { class: 'tab', type: 'button' }, 'Вся Россия');
  const tabDuel = h('button', { class: 'tab', type: 'button' }, 'Дуэль');

  // ---------- Город ----------
  const search = h('input', {
    class: 'search',
    type: 'search',
    placeholder: `Поиск среди ${CITY_LIST.length} городов`,
    autocomplete: 'off',
    'aria-label': 'Поиск города',
  });
  const list = h('ul', { class: 'city-list', role: 'listbox' });
  const listNote = h('p', { class: 'city-empty', hidden: true });
  const playBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: true },
    'Играть только в этом городе');
  const cityPane = h('div', { class: 'pane' }, search, list, listNote, playBtn);

  // ---------- Россия ----------
  const russiaBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Играть по всей России');
  const russiaPane = h('div', { class: 'pane' },
    h('div', { class: 'russia-card' },
      h('div', { class: 'russia-emoji' }, '🇷🇺'),
      h('p', {}, 'Случайные панорамы по всей стране — от Калининграда до Владивостока: города, пригороды и трассы.'),
      h('p', { class: 'muted' }, 'Карта — вся Россия. Очки считаются по масштабу страны, как в GeoGuessr.'),
    ),
    russiaBtn,
  );

  // ---------- Дуэль ----------
  const duelCreateBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Создать дуэль');
  const duelLinkInput = h('input', {
    class: 'duel-link-input',
    type: 'text',
    readonly: true,
    'aria-label': 'Ссылка на дуэль',
  });
  const duelCopyBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Копировать');
  const duelLinkRow = h('div', { class: 'duel-link-row', hidden: true }, duelLinkInput, duelCopyBtn);
  const duelPlayBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', hidden: true },
    'Играть дуэль');
  const duelHint = h('p', { class: 'muted small', hidden: true });

  const duelJoinInput = h('input', {
    class: 'search search-plain',
    type: 'text',
    placeholder: 'Вставьте ссылку или код дуэли',
    autocomplete: 'off',
    'aria-label': 'Ссылка на дуэль',
  });
  const duelJoinBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Присоединиться');
  const duelJoinError = h('p', { class: 'city-empty', hidden: true });

  const duelPane = h('div', { class: 'pane' },
    h('div', { class: 'russia-card' },
      h('div', { class: 'russia-emoji' }, '⚔️'),
      h('p', {}, 'У вас с соперником будут одинаковые 5 панорам — сид задаёт точки обоим.'),
      h('p', { class: 'muted' },
        'Создайте дуэль и отправьте ссылку другу, или присоединитесь по ссылке. После игры сравните счёт.'),
    ),
    duelCreateBtn,
    duelLinkRow,
    duelPlayBtn,
    duelHint,
    h('div', { class: 'duel-divider' }, h('span', {}, 'или')),
    duelJoinInput,
    duelJoinBtn,
    duelJoinError,
  );

  // ---------- Логика ----------
  const renderList = (items: CityListItem[]) => {
    const shown = items.slice(0, LIST_LIMIT);
    list.replaceChildren(
      ...shown.map((city) =>
        h('li', {
          class: `city-item${city.id === selectedId ? ' is-selected' : ''}`,
          role: 'option',
          tabindex: 0,
          'aria-selected': city.id === selectedId ? 'true' : 'false',
          'data-id': city.id,
        },
          h('span', { class: 'city-name' }, city.name,
            h('span', { class: 'city-region' }, city.region)),
          h('span', { class: 'city-pop' }, formatPopulation(city.population)),
        ),
      ),
    );
    if (!items.length) {
      listNote.textContent = 'Город не найден';
      listNote.hidden = false;
    } else if (items.length > LIST_LIMIT) {
      listNote.textContent = `Показаны ${LIST_LIMIT} из ${items.length} — уточните поиск`;
      listNote.hidden = false;
    } else {
      listNote.hidden = true;
    }
  };

  const select = (id: string) => {
    selectedId = id;
    playBtn.disabled = false;
    list.querySelectorAll<HTMLLIElement>('.city-item').forEach((el) => {
      const isSel = el.dataset.id === id;
      el.classList.toggle('is-selected', isSel);
      el.setAttribute('aria-selected', String(isSel));
    });
  };

  const playCity = (id: string) => options.onPlay({ kind: 'city', cityId: id });

  const setMode = (next: Mode) => {
    mode = next;
    tabCity.classList.toggle('is-active', mode === 'city');
    tabRussia.classList.toggle('is-active', mode === 'russia');
    tabDuel.classList.toggle('is-active', mode === 'duel');
    cityPane.hidden = mode !== 'city';
    russiaPane.hidden = mode !== 'russia';
    duelPane.hidden = mode !== 'duel';
    if (mode === 'city') search.focus();
    else if (mode === 'russia') russiaBtn.focus();
    else duelCreateBtn.focus();
  };

  tabCity.addEventListener('click', () => setMode('city'));
  tabRussia.addEventListener('click', () => setMode('russia'));
  tabDuel.addEventListener('click', () => setMode('duel'));
  russiaBtn.addEventListener('click', () => options.onPlay({ kind: 'russia' }));

  // ---------- Логика дуэли ----------
  let duel: DuelInfo | null = null;

  duelCreateBtn.addEventListener('click', () => {
    duel = { region: DUEL_REGION, seed: randomSeed() };
    const link = absoluteHashUrl(buildDuelHash(duel));
    duelLinkInput.value = link;
    show(duelLinkRow, true);
    show(duelPlayBtn, true);
    show(duelHint, true);
    duelHint.textContent =
      'Ссылка скопирована в буфер обмена — отправьте её сопернику. А сами нажмите «Играть дуэль».';
    void copyText(link);
  });

  duelCopyBtn.addEventListener('click', async () => {
    if (await copyText(duelLinkInput.value)) {
      duelCopyBtn.textContent = 'Скопировано ✓';
      setTimeout(() => (duelCopyBtn.textContent = 'Копировать'), 1500);
    }
  });

  duelPlayBtn.addEventListener('click', () => {
    if (duel) options.onJoinDuel(duel);
  });

  const joinDuel = () => {
    const parsed = parseDuelInput(duelJoinInput.value);
    if (parsed) {
      show(duelJoinError, false);
      options.onJoinDuel(parsed);
    } else {
      duelJoinError.textContent = 'Не похоже на ссылку дуэли — проверьте и вставьте ещё раз';
      show(duelJoinError, true);
    }
  };
  duelJoinBtn.addEventListener('click', joinDuel);
  duelJoinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinDuel();
  });

  search.addEventListener('input', () => {
    const items = searchCities(search.value);
    renderList(items);
    if (items.length === 1) select(items[0].id);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = searchCities(search.value)[0];
      if (selectedId) playCity(selectedId);
      else if (first) select(first.id);
    }
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLLIElement>('.city-item');
    if (item?.dataset.id) select(item.dataset.id);
  });
  list.addEventListener('dblclick', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLLIElement>('.city-item');
    if (item?.dataset.id) playCity(item.dataset.id);
  });
  list.addEventListener('keydown', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLLIElement>('.city-item');
    if (!item?.dataset.id) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectedId === item.dataset.id && e.key === 'Enter') playCity(item.dataset.id);
      else select(item.dataset.id);
    }
  });
  playBtn.addEventListener('click', () => {
    if (selectedId) playCity(selectedId);
  });

  // Если город был выбран раньше — показываем его первым в списке.
  const initial = searchCities('');
  const prev = selectedId ? initial.find((c) => c.id === selectedId) : undefined;
  renderList(prev ? [prev, ...initial.filter((c) => c !== prev)] : initial);
  if (selectedId) select(selectedId);

  const screen = h('div', { class: 'screen start' },
    h('div', { class: 'start-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-pin' }), GAME_TITLE),
      h('p', { class: 'subtitle' }, GAME_SUBTITLE),
      h('div', { class: 'tabs' }, tabCity, tabRussia, tabDuel),
      cityPane,
      russiaPane,
      duelPane,
    ),
  );

  root.replaceChildren(screen);
  setMode(mode);
  return () => screen.remove();
}
