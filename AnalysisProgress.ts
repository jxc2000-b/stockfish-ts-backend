export type AnalysisStage = 'idle' | 'importing' | 'parsing' | 'analyzing' | 'complete' | 'error';

export interface AnalysisProgressSnapshot {
  active: boolean;
  stage: AnalysisStage;
  playerName: string;
  processedMoves: number;
  totalMoves: number;
  currentGame: string;
  message: string;
}

const INITIAL_PROGRESS: AnalysisProgressSnapshot = {
  active: false,
  stage: 'idle',
  playerName: '',
  processedMoves: 0,
  totalMoves: 0,
  currentGame: '',
  message: '',
};

const progressState: AnalysisProgressSnapshot = { ...INITIAL_PROGRESS };

function assignProgress(next: Partial<AnalysisProgressSnapshot>): void {
  Object.assign(progressState, next);
}

export function getAnalysisProgressSnapshot(): AnalysisProgressSnapshot {
  return structuredClone(progressState);
}

export function beginAnalysisProgress({
  playerName,
  stage,
  message,
}: {
  playerName: string;
  stage: Extract<AnalysisStage, 'importing' | 'parsing' | 'analyzing'>;
  message: string;
}): void {
  // This is intentionally a single in-memory snapshot. It is enough for one
  // foreground analysis flow without introducing a full per-job store yet.
  assignProgress({
    ...INITIAL_PROGRESS,
    active: true,
    playerName: String(playerName || '').trim(),
    stage,
    message,
  });
}

export function updateAnalysisProgress(
  next: Partial<Pick<AnalysisProgressSnapshot, 'stage' | 'processedMoves' | 'totalMoves' | 'currentGame' | 'message'>>
): void {
  assignProgress({
    active: true,
    ...next,
  });
}

export function completeAnalysisProgress(message: string): void {
  assignProgress({
    active: false,
    stage: 'complete',
    currentGame: '',
    message,
  });
}

export function failAnalysisProgress(message: string): void {
  assignProgress({
    active: false,
    stage: 'error',
    currentGame: '',
    message,
  });
}

export function resetAnalysisProgress(): void {
  assignProgress({ ...INITIAL_PROGRESS });
}
