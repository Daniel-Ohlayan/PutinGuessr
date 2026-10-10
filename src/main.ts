import './styles.css';
import { GAME_TITLE } from './config';
import { loadCity, loadRussiaGeometry } from './data/cities';
import {
  absoluteHashUrl,
  buildDuelHash,
  buildDuelResultHash,
  buildDuelResultPayload,
  duelSelection,
  loadDuelResult,
  saveDuelResult,
} from './duel/duel';
import { type GameSession, type DuelInfo } from './game/gameSession';
import { createCityRegion, createRussiaRegion, type GameRegion, type RegionSelection } from './game/region';
import { createRoundPlan } from './game/roundPlan';
import { loadYmaps } from './map/ymapsLoader';
import { parseHash, watchHash } from './router';
import { renderDuelResultScreen } from './ui/duelResultScreen';
import { renderFinalScreen } from './ui/finalScreen';
import { renderGameScreen } from './ui/gameScreen';
import { renderStartScreen } from './ui/startScreen';

const root = document.getElementById('app') as HTMLElement;
document.title = GAME_TITLE;
let cleanup: (() => void) | null = null;
let lastSelection: RegionSelection | null = null;

function mount(render: () => () => void): void {
  cleanup?.();
  cleanup = render();
}

async function loadRegion(selection: RegionSelection): Promise<GameRegion> {
  if (selection.kind === 'city') {
    return createCityRegion(await loadCity(selection.cityId));
  }
  return createRussiaRegion(await loadRussiaGeometry());
}

function navigate(hash: string): void {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function goToStart(): void {
  navigate('#/');
}

function startGame(selection: RegionSelection): void {
  lastSelection = selection;
  mount(() =>
    renderGameScreen(root, async () => ({ region: await loadRegion(selection) }), {
      onExit: goToStart,
      onFinish: (session) => finishGame(session, () => startGame(selection)),
    }),
  );
}

/** Сидированная игра (дуэль): один и тот же сид — одни и те же точки у обоих игроков. */
function startDuel(selection: RegionSelection, duel: DuelInfo): void {
  lastSelection = selection;
  mount(() =>
    renderGameScreen(
      root,
      async () => {
        const region = await loadRegion(selection);
        return { region, plan: await createRoundPlan(region, duel.seed) };
      },
      {
        duel,
        onExit: goToStart,
        onFinish: (session) => finishGame(session, () => startDuel(selection, duel)),
      },
    ),
  );
}

function finishGame(session: GameSession, replay: () => void): void {
  const duel = session.duel;
  let duelShare: { shareLink: string; resultLink: string } | null = null;
  if (duel) {
    const payload = buildDuelResultPayload(session.results);
    saveDuelResult(duel, payload);
    duelShare = {
      shareLink: absoluteHashUrl(buildDuelHash(duel)),
      resultLink: absoluteHashUrl(buildDuelResultHash(duel, payload)),
    };
  }
  mount(() =>
    renderFinalScreen(root, session, {
      onReplay: replay,
      onChangeCity: goToStart,
      duel: duelShare,
    }),
  );
}

function route(): void {
  const current = parseHash(location.hash);
  if (current.kind === 'duel') {
    const selection = duelSelection(current.region);
    if (selection) startDuel(selection, { region: current.region, seed: current.seed });
    else goToStart();
    return;
  }
  if (current.kind === 'duelResult') {
    const duel: DuelInfo = { region: current.region, seed: current.seed };
    mount(() =>
      renderDuelResultScreen(
        root,
        { duel, opponent: current.payload, own: loadDuelResult(duel) },
        {
          onPlay: () => navigate(buildDuelHash(duel)),
          onExit: goToStart,
        },
      ),
    );
    return;
  }
  mount(() =>
    renderStartScreen(root, {
      selectedId: lastSelection?.kind === 'city' ? lastSelection.cityId : null,
      mode: lastSelection?.kind ?? 'city',
      onPlay: startGame,
      onJoinDuel: (duel) => navigate(buildDuelHash(duel)),
    }),
  );
}

watchHash(route);
route();
// Заранее подгружаем API, пока пользователь выбирает режим.
loadYmaps().catch(() => undefined);
