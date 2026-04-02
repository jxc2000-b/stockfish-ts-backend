import { ParsedInfoLine } from './StockfishEngine';

export interface SourceGameMetadata {
  gameId: string;
  sourceFileId: string;
  sourceFilename: string;
  white: string;
  black: string;
  date: string;
  result: string;
  opening: string;
  event: string;
  site: string;
}

export interface TrainingPosition {
  id: string;
  analyzedMoveId: string;
  fen: string;
  correctMove: string;
  correctMoveSan: string | null;
  playedMove: string;
  playedMoveUci: string;
  evalLoss: number;
  severity: string;
  principalVariation: string[];
  multiPv: ParsedInfoLine[];
  sourceGameMetadata: SourceGameMetadata;
}

export interface TrainingAttempt {
  id: string;
  trainingPositionId: string;
  userAnswer: string;
  correct: boolean;
  responseTimeMs: number;
  attemptedAt: string;
}

export interface AnalyzedMoveData {
  id: string;
}

export interface UploadedFileData {
  id: string;
  originalFilename: string;
  uploadTimestamp: string;
}

export interface ParseErrorData {
  sourceFileId: string;
  sourceFilename: string;
  message: string;
}

export interface GameData {
  id: string;
}

interface StoreState {
  uploadedFiles: UploadedFileData[];
  uploadErrors: ParseErrorData[];
  games: GameData[];
  analyzedMoves: AnalyzedMoveData[];
  trainingPositions: TrainingPosition[];
  trainingAttempts: TrainingAttempt[];
  nextAttemptId: number;
}

const state: StoreState = {
  uploadedFiles: [],
  uploadErrors: [],
  games: [],
  analyzedMoves: [],
  trainingPositions: [], //array of positions user will play
  trainingAttempts: [], //
  nextAttemptId: 1,
};

//resets state
export function resetStore(): void {
  state.uploadedFiles = [];
  state.uploadErrors = [];
  state.games = [];
  state.analyzedMoves = [];
  state.trainingPositions = [];
  state.trainingAttempts = [];
  state.nextAttemptId = 1;
}

//clears analysisData (different shape from state)
export function replaceAnalysisData({
  uploadedFiles = [],
  uploadErrors = [],
  games = [],
  analyzedMoves = [],
  trainingPositions = [],
}: {
  uploadedFiles?: UploadedFileData[];
  uploadErrors?: ParseErrorData[];
  games?: GameData[];
  analyzedMoves?: AnalyzedMoveData[];
  trainingPositions?: TrainingPosition[];
}): void {
  state.uploadedFiles = structuredClone(uploadedFiles);
  state.uploadErrors = structuredClone(uploadErrors);
  state.games = structuredClone(games);
  state.analyzedMoves = structuredClone(analyzedMoves);
  state.trainingPositions = structuredClone(trainingPositions);
  state.trainingAttempts = [];
  state.nextAttemptId = 1;
}


export function getTrainingPositionById(trainingPositionId: string | number): TrainingPosition | undefined {
  return state.trainingPositions.find((position) => position.id === String(trainingPositionId));
}

//gets array of 20 training positions
export function getTrainingSession(limit: number = 20): { totalPositions: number; positions: TrainingPosition[] } {
  return structuredClone({
    totalPositions: state.trainingPositions.length,
    positions: state.trainingPositions.slice(0, limit),
  });
}

// removes whitespaces, changes characters to lowercase and removes '+' and '#' 
function normalizeAnswer(answer: string | null | undefined): string {
  return String(answer || '')
    .trim()
    .toLowerCase()
    .replace(/[+#]+$/g, '');
}

export interface RecordAttemptInput {
  trainingPositionId: string;
  userAnswer: string;
  responseTimeMs: number;
}

export interface RecordAttemptResult {
  correct: boolean;
  correctMove: string;
  correctMoveSan: string | null;
  attempt: TrainingAttempt;
}

export function recordTrainingAttempt({ trainingPositionId, userAnswer, responseTimeMs }: RecordAttemptInput): RecordAttemptResult {
  const trainingPosition: TrainingPosition | undefined = getTrainingPositionById(trainingPositionId);

  if (!trainingPosition) { //ensure position exists
    throw new Error(`Unknown training position: ${trainingPositionId}`);
  }

  const normalizedAnswer: string = normalizeAnswer(userAnswer); //sanitizing
  const correct: boolean =
    normalizedAnswer === normalizeAnswer(trainingPosition.correctMove) ||
    normalizedAnswer === normalizeAnswer(trainingPosition.correctMoveSan);

  const attempt: TrainingAttempt = { //store attempt 
    id: `attempt-${state.nextAttemptId++}`,
    trainingPositionId: trainingPosition.id,
    userAnswer, // this 
    correct,
    responseTimeMs, //and this are defensive against bad inputs
    attemptedAt: new Date().toISOString(),
  };

  state.trainingAttempts.push(attempt); //push to state

  return {
    correct,
    correctMove: trainingPosition.correctMove,
    correctMoveSan: trainingPosition.correctMoveSan,
    attempt,
  };
}

export interface AttemptsByPositionEntry {
  trainingPositionId: string;
  evalLoss: number;
  attempts: number;
  correctAttempts: number;
  averageResponseTimeMs: number | null;
}

export interface TrainingStats {
  totalUploadedFiles: number;
  totalGames: number;
  totalAnalyzedMoves: number;
  totalTrainingPositions: number;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number;
  attemptsByPosition: AttemptsByPositionEntry[];
}

export function getTrainingStats(): TrainingStats {
  const totalAttempts: number = state.trainingAttempts.length;
  const correctAttempts: number = state.trainingAttempts.filter((attempt) => attempt.correct).length;
  const accuracy: number = totalAttempts > 0 ? Number((correctAttempts / totalAttempts).toFixed(2)) : 0;

  const attemptsByPosition: AttemptsByPositionEntry[] = state.trainingPositions.map((position) => { // nested scan scales badly with memory
    const attempts: TrainingAttempt[] = state.trainingAttempts.filter(
      (attempt) => attempt.trainingPositionId === position.id
    );
    const averageResponseTimeMs: number | null = 
      attempts.length > 0
        ? Math.round(
            attempts.reduce((sum, attempt) => sum + attempt.responseTimeMs, 0) / attempts.length
          )
        : null; //avg response kinda useless

    return {
      trainingPositionId: position.id,
      evalLoss: position.evalLoss,
      attempts: attempts.length,
      correctAttempts: attempts.filter((attempt) => attempt.correct).length,
      averageResponseTimeMs,
    };
  });

  return {
    totalUploadedFiles: state.uploadedFiles.length,
    totalGames: state.games.length,
    totalAnalyzedMoves: state.analyzedMoves.length,
    totalTrainingPositions: state.trainingPositions.length,
    totalAttempts,
    correctAttempts,
    accuracy,
    attemptsByPosition,
  };
}

export interface StateSnapshot {
  uploadedFiles: UploadedFileData[];
  uploadErrors: ParseErrorData[];
  games: GameData[];
  analyzedMoves: AnalyzedMoveData[];
  trainingPositions: TrainingPosition[];
  trainingAttempts: TrainingAttempt[];
}

export function getStateSnapshot(): StateSnapshot {
  return {
    uploadedFiles: state.uploadedFiles,
    uploadErrors: state.uploadErrors,
    games: state.games,
    analyzedMoves: state.analyzedMoves,
    trainingPositions: state.trainingPositions,
    trainingAttempts: state.trainingAttempts,
  };
}
