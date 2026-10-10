import { distanceMeters, type LatLng } from '../utils/geo';
import { createRng } from '../utils/random';
import type { GameRegion } from './region';
import { calculateScore, MAX_ROUND_SCORE } from './scoring';

export const TOTAL_ROUNDS = 5;

export interface RoundResult {
  round: number;
  real: LatLng;
  guess: LatLng;
  distance: number;
  score: number;
}

/** Дуэль: сид определяет одни и те же точки для обоих игроков. */
export interface DuelInfo {
  /** Ключ региона в ссылке на дуэль (например, «russia»). */
  region: string;
  seed: string;
}

/** Состояние одной игры (в памяти). */
export class GameSession {
  readonly totalRounds = TOTAL_ROUNDS;
  readonly maxTotalScore = TOTAL_ROUNDS * MAX_ROUND_SCORE;
  readonly results: RoundResult[] = [];
  readonly duel: DuelInfo | null;
  /**
   * ГПСЧ для запасного живого поиска в дуэли: если план точек исчерпан,
   * поиск продолжается детерминированно — у обоих игроков точки совпадут.
   */
  readonly liveRng: (() => number) | null;
  private currentRound = 0;
  private currentReal: LatLng | null = null;
  /** Точки-кандидаты сидированной игры (дуэли); null — обычная случайная игра. */
  private plan: LatLng[] | null;
  private planIndex = 0;

  constructor(
    readonly region: GameRegion,
    options: { plan?: LatLng[] | null; duel?: DuelInfo | null } = {},
  ) {
    this.plan = options.plan ?? null;
    this.duel = options.duel ?? null;
    this.liveRng = options.duel ? createRng(`${options.duel.seed}:live`) : null;
  }

  /** Остались ли неразобранные точки в плане сидированной игры. */
  get hasPlan(): boolean {
    return this.plan !== null && this.planIndex < this.plan.length;
  }

  /** Следующая точка-кандидат из плана; null — план исчерпан. */
  takePlanCandidate(): LatLng | null {
    if (!this.plan) return null;
    return this.plan[this.planIndex++] ?? null;
  }

  get round(): number {
    return this.currentRound;
  }

  get totalScore(): number {
    return this.results.reduce((sum, r) => sum + r.score, 0);
  }

  get averageDistance(): number {
    if (!this.results.length) return 0;
    return this.results.reduce((sum, r) => sum + r.distance, 0) / this.results.length;
  }

  get isLastRound(): boolean {
    return this.currentRound >= this.totalRounds;
  }

  get isFinished(): boolean {
    return this.results.length >= this.totalRounds;
  }

  /** Позиции уже использованных панорам — чтобы не повторяться. */
  get usedPositions(): LatLng[] {
    const used = this.results.map((r) => r.real);
    if (this.currentReal) used.push(this.currentReal);
    return used;
  }

  nextRound(): number {
    if (this.currentRound >= this.totalRounds) {
      throw new Error('Все раунды уже сыграны');
    }
    this.currentRound++;
    this.currentReal = null;
    return this.currentRound;
  }

  setPanoramaPosition(position: LatLng): void {
    this.currentReal = position;
  }

  submitGuess(guess: LatLng): RoundResult {
    if (!this.currentReal) {
      throw new Error('Панорама раунда ещё не загружена');
    }
    const distance = distanceMeters(this.currentReal, guess);
    const result: RoundResult = {
      round: this.currentRound,
      real: this.currentReal,
      guess,
      distance,
      score: calculateScore(distance, this.region.mapSize),
    };
    this.results.push(result);
    this.currentReal = null;
    return result;
  }
}
