import { GameSession, type DuelInfo, type RoundResult } from '../game/gameSession';
import type { GameRegion } from '../game/region';
import { MAX_ROUND_SCORE } from '../game/scoring';
import { GuessMap } from '../map/guessMap';
import { loadYmaps } from '../map/ymapsLoader';
import { PanoramaView } from '../panorama/panoramaView';
import { PanoramaSearchError, type FoundPanorama } from '../panorama/randomPanorama';
import { GAME_TITLE } from '../config';
import { getApiKey } from '../utils/apiKey';
import { h, show } from '../utils/dom';
import { formatDistance, formatScore, pluralizePoints } from '../utils/format';
import type { LatLng } from '../utils/geo';

export interface GameScreenOptions {
  onFinish: (session: GameSession) => void;
  onExit: () => void;
  /** Дуэль: игра по сидированному плану раундов. */
  duel?: DuelInfo | null;
}

export interface LoadedGame {
  region: GameRegion;
  /** Точки-кандидаты по сиду (дуэль); отсутствует в обычной игре. */
  plan?: LatLng[] | null;
}

export function renderGameScreen(
  root: HTMLElement,
  loadGame: () => Promise<LoadedGame>,
  options: GameScreenOptions,
): () => void {
  let session: GameSession | null = null;
  let destroyed = false;
  let roundToken = 0;
  let guessMap: GuessMap | null = null;
  let panoramaView: PanoramaView | null = null;
  let prefetched: Promise<FoundPanorama | null> | null = null;
  let roundReady = false;
  /** Точка из плана, которую разрезолвываем в панораму в этом раунде. */
  let currentCandidate: LatLng | null = null;

  // ---------- Разметка ----------
  const roundLabel = h('span', { class: 'hud-value' }, '–');
  const scoreLabel = h('span', { class: 'hud-value' }, '0');
  const exitBtn = h('button', { class: 'btn btn-ghost', type: 'button', title: 'Выйти в меню' }, 'Выйти');

  const panoEl = h('div', { class: 'pano' });
  const loadingText = h('span', {}, 'Ищем панораму…');
  const loadingOverlay = h('div', { class: 'overlay' }, h('div', { class: 'spinner' }), loadingText);
  const errorText = h('p', { class: 'overlay-text' });
  const retryBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Попробовать снова');
  const errorOverlay = h('div', { class: 'overlay overlay-error', hidden: true },
    h('div', { class: 'overlay-icon' }, '!'), errorText, retryBtn);

  const mapEl = h('div', { class: 'guess-map' });
  const hint = h('div', { class: 'hint' }, 'Кликните по карте, чтобы поставить метку');
  const guessBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, 'Угадать');

  const resDistance = h('div', { class: 'result-distance' });
  const resScore = h('div', { class: 'result-score' });
  const resBar = h('span');
  const nextBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Следующий раунд');
  const resultBlock = h('div', { class: 'result', hidden: true },
    h('div', { class: 'result-row' },
      h('div', {}, h('div', { class: 'result-label' }, 'Расстояние'), resDistance),
      h('div', { class: 'result-right' }, h('div', { class: 'result-label' }, 'Очки'), resScore)),
    h('div', { class: 'progress' }, resBar),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'dot dot-red' }), 'Панорама'),
      h('span', {}, h('i', { class: 'dot dot-blue' }), 'Ваш ответ')),
    nextBtn,
  );
  const guessBlock = h('div', { class: 'guess-block' }, hint, guessBtn);
  const pinBtn = h('button', {
    class: 'map-tool', type: 'button', title: 'Закрепить большую карту',
  }, '⤢');
  let side!: HTMLElement;

  const screen = h('div', { class: 'screen game' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'logo-pin logo-pin-sm' }), GAME_TITLE),
      h('div', { class: 'hud' },
        h('div', { class: 'hud-item' }, h('span', { class: 'hud-label' }, 'Раунд'), roundLabel),
        h('div', { class: 'hud-item' }, h('span', { class: 'hud-label' }, 'Счёт'), scoreLabel)),
      exitBtn,
    ),
    h('main', { class: 'game-body' },
      h('section', { class: 'pano-wrap' }, panoEl, loadingOverlay, errorOverlay),
      side = h('aside', { class: 'side' },
        h('div', { class: 'map-wrap' }, mapEl, h('div', { class: 'map-tools' }, pinBtn)),
        h('div', { class: 'panel' }, guessBlock, resultBlock),
      ),
    ),
  );
  root.replaceChildren(screen);

  // ---------- Логика ----------
  const updateHud = () => {
    if (!session) return;
    roundLabel.textContent = `${session.round} / ${session.totalRounds}`;
    scoreLabel.textContent = formatScore(session.totalScore);
  };

  const setLoading = (text: string) => {
    loadingText.textContent = text;
    show(loadingOverlay, true);
    show(errorOverlay, false);
  };

  const setError = (message: string, onRetry: () => void) => {
    errorText.textContent = message;
    retryBtn.onclick = onRetry;
    show(loadingOverlay, false);
    show(errorOverlay, true);
  };

  const updateGuessButton = () => {
    guessBtn.disabled = !(roundReady && guessMap?.getGuess());
  };

  /**
   * Панорама текущего раунда. В сидированной игре (дуэли) — по точке из плана
   * (один вызов API на точную позицию, та же панорама у обоих игроков);
   * если план исчерпан — обычный живой случайный поиск.
   */
  const acquirePanorama = async (): Promise<FoundPanorama> => {
    if (!session) throw new Error('Игра не инициализирована');
    while (currentCandidate !== null || session.hasPlan) {
      if (currentCandidate === null) currentCandidate = session.takePlanCandidate();
      if (currentCandidate === null) break;
      const found = await session.region.findPanoramaAt(currentCandidate);
      if (found) return found;
      currentCandidate = null; // рядом с этой точкой панорамы нет — берём следующую из плана
    }
    return session.region.findPanorama({
      exclude: session.usedPositions,
      minSeparation: session.region.minSeparation,
      // В дуэли запасной поиск тоже детерминирован — точки совпадут у обоих игроков.
      rng: session.liveRng ?? undefined,
    });
  };

  const errorMessage = (error: unknown): string => {
    if (error instanceof PanoramaSearchError) {
      return error.reason === 'not-found'
        ? `${error.message} Возможно, здесь мало панорам — попробуйте ещё раз.`
        : `${error.message}${error.details ? `\nОтвет Яндекса: ${error.details}` : ''}\nКлюч в src/config.ts: ${getApiKey() ? 'задан' : 'НЕ задан'}.`;
    }
    return 'Не удалось загрузить панораму. Проверьте подключение к интернету.';
  };

  const loadRoundPanorama = async () => {
    const token = ++roundToken;
    roundReady = false;
    updateGuessButton();
    setLoading('Ищем панораму…');

    try {
      let found: FoundPanorama | null = null;
      if (prefetched) {
        found = await prefetched;
        prefetched = null;
      }
      if (!found) found = await acquirePanorama();
      if (destroyed || token !== roundToken || !session) return;

      session.setPanoramaPosition(found.position);
      panoramaView?.show(found.panorama);
      show(loadingOverlay, false);
      roundReady = true;
      updateGuessButton();
    } catch (error) {
      if (destroyed || token !== roundToken) return;
      setError(errorMessage(error), () => void loadRoundPanorama());
    }
  };

  const startRound = () => {
    if (!session) return;
    currentCandidate = null;
    side.classList.remove('is-result');
    session.nextRound();
    updateHud();
    show(resultBlock, false);
    show(guessBlock, true);
    guessMap?.reset();
    void loadRoundPanorama();
  };

  const showRoundResult = (result: RoundResult) => {
    resDistance.textContent = formatDistance(result.distance);
    resScore.textContent = `${formatScore(result.score)} ${pluralizePoints(result.score)}`;
    resBar.style.width = `${(result.score / MAX_ROUND_SCORE) * 100}%`;
    nextBtn.textContent = session?.isFinished ? 'Посмотреть результат' : 'Следующий раунд';
    show(guessBlock, false);
    show(resultBlock, true);
    side.classList.add('is-result');
    nextBtn.focus();
  };

  const submitGuess = () => {
    const guess = guessMap?.getGuess();
    if (!guessMap || !guess || !roundReady || !session) return;
    roundReady = false;
    const result = session.submitGuess(guess);
    guessMap.showResult(result.real, result.guess);
    updateHud();
    showRoundResult(result);

    // Пока игрок смотрит результат — заранее ищем следующую панораму.
    // В сидированной игре с планом не нужно: там один быстрый запрос на точную позицию.
    if (!session.isFinished && !session.hasPlan) {
      prefetched = acquirePanorama().catch(() => null);
    }
  };

  guessBtn.addEventListener('click', submitGuess);
  pinBtn.addEventListener('click', () => {
    const pinned = side.classList.toggle('is-pinned');
    pinBtn.classList.toggle('is-active', pinned);
    pinBtn.title = pinned ? 'Открепить карту' : 'Закрепить большую карту';
  });
  nextBtn.addEventListener('click', () => {
    if (!session) return;
    if (session.isFinished) options.onFinish(session);
    else startRound();
  });
  exitBtn.addEventListener('click', options.onExit);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.repeat) return;
    if (!guessBtn.disabled && !guessBlock.hidden) {
      e.preventDefault();
      submitGuess();
    } else if (!resultBlock.hidden) {
      e.preventDefault();
      nextBtn.click();
    }
  };
  document.addEventListener('keydown', onKey);

  const init = async () => {
    setLoading('Загружаем карты…');
    try {
      await loadYmaps();
    } catch {
      if (destroyed) return;
      setError(
        'Не удалось загрузить Яндекс.Карты. Проверьте подключение к интернету и API-ключ.',
        () => void init(),
      );
      return;
    }
    let game: LoadedGame;
    let region: GameRegion;
    try {
      game = await loadGame();
      region = game.region;
    } catch {
      if (destroyed) return;
      setError('Не удалось загрузить границы. Проверьте подключение и попробуйте снова.', () => void init());
      return;
    }
    if (destroyed) return;
    session = new GameSession(region, { plan: game.plan ?? null, duel: options.duel ?? null });
    panoramaView = new PanoramaView(panoEl);
    guessMap = new GuessMap(
      mapEl,
      { bounds: region.mapBounds, outline: region.outline, minZoom: region.minZoom },
      () => updateGuessButton(),
    );
    startRound();
  };
  void init();

  return () => {
    destroyed = true;
    roundToken++;
    document.removeEventListener('keydown', onKey);
    panoramaView?.destroy();
    guessMap?.destroy();
    screen.remove();
  };
}
