import { Chess } from 'chess.js';
import { analyzePosition as defaultAnalyzePosition, ParsedInfoLine } from './stockfishEngine';
import { ParsedGame } from './ParsePgn';
import { SourceGameMetadata, TrainingPosition } from './TrainingStore';

type AnalyzePositionFn = typeof defaultAnalyzePosition;
type AnalysisResult = Awaited<ReturnType<AnalyzePositionFn>>;

export const DEFAULT_DEPTH = 10;
export const DEFAULT_ERROR_THRESHOLD = 0.8;
export const DEFAULT_MULTIPV = 3;
const ANALYSIS_LOGGING_ENABLED: boolean = process.env.ANALYSIS_LOG !== '0';

function logAnalysis(message: string): void {
  if (!ANALYSIS_LOGGING_ENABLED) {
    return;
  }

  console.log(`[${new Date().toISOString()}] [analysis] ${message}`);
}

export function roundScore(value: number): number {
  return Number(value.toFixed(2));
}

export function normalizePlayerName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function getTrackedColor(game: ParsedGame, playerName: string | null | undefined): 'white' | 'black' | null {
  const normalizedPlayerName = normalizePlayerName(playerName);

  if (!normalizedPlayerName) {
    return null;
  }

  if (normalizePlayerName(game.white) === normalizedPlayerName) {
    return 'white';
  }

  if (normalizePlayerName(game.black) === normalizedPlayerName) {
    return 'black';
  }

  return null;
}

export function classifyEvalLoss(evalLoss: number | null, errorThreshold: number = DEFAULT_ERROR_THRESHOLD): string {
  if (typeof evalLoss !== 'number') {
    return 'unscored';
  }

  if (evalLoss >= 3) {
    return 'blunder';
  }

  if (evalLoss >= 1.5) {
    return 'mistake';
  }

  if (evalLoss >= errorThreshold) {
    return 'inaccuracy';
  }

  return 'ok';
}

export function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci) {
    return null;
  }

  const match: RegExpMatchArray | null = uci.match(/^([a-h][1-8])([a-h][1-8])([nbrq])?$/);

  if (!match) {
    return null;
  }

  const chess = new Chess(fen);
  const move = chess.move({
    from: match[1],
    to: match[2],
    promotion: match[3],
  });

  return move ? move.san : null;
}

export function buildSourceGameMetadata(game: ParsedGame): SourceGameMetadata {
  return {
    gameId: game.id,
    sourceFileId: game.sourceFileId,
    sourceFilename: game.sourceFilename,
    white: game.white,
    black: game.black,
    date: game.date,
    result: game.result,
    opening: game.opening,
    event: game.event,
    site: game.site,
  };
}

export interface AnalyzedMove {
  id: string;
  gameId: string;
  plyIndex: number;
  moveNumber: number;
  color: string;
  fenBeforeMove: string;
  fenAfterMove: string;
  playedMove: string;
  playedMoveUci: string;
  bestMove: string | null;
  bestMoveSan: string | null;
  evalBefore: number | null;
  evalBeforeText: string | null;
  evalAfter: number | null;
  evalAfterText: string | null;
  evalLoss: number | null;
  severity: string;
  principalVariation: string[];
  multiPv: ParsedInfoLine[];
  sourceGameMetadata: SourceGameMetadata;
}

export interface AnalyzeGamesOptions {
  analyzePosition?: AnalyzePositionFn;
  depth?: number;
  errorThreshold?: number;
  multiPv?: number;
  playerName?: string;
  onProgress?: (update: AnalysisProgressUpdate) => void;
}

export interface AnalyzeGamesResult {
  analyzedMoves: AnalyzedMove[];
  trainingPositions: TrainingPosition[];
}

export interface AnalysisProgressUpdate {
  stage: 'analyzing';
  processedMoves: number;
  totalMoves: number;
  currentGame: string;
  message: string;
}

function getTrackedReplyMove(game: ParsedGame, moveIndex: number, trackedColor: 'white' | 'black' | null) {
  if (!trackedColor) {
    return null;
  }

  const nextMove = game.moves[moveIndex + 1];

  if (!nextMove || nextMove.color !== trackedColor) {
    return null;
  }

  return nextMove;
}

function shouldAnalyzeMove(
  game: ParsedGame,
  moveIndex: number,
  trackedColor: 'white' | 'black' | null
): boolean {
  if (!trackedColor) {
    return true;
  }

  const move = game.moves[moveIndex];

  // In tracked-player mode, only analyze opponent plies that could immediately
  // become a user-to-move training position on the next ply.
  return move.color !== trackedColor && Boolean(getTrackedReplyMove(game, moveIndex, trackedColor));
}

function countMovesToAnalyze(games: ParsedGame[], playerName: string): number {
  return games.reduce((sum, game) => {
    const trackedColor = getTrackedColor(game, playerName);

    if (normalizePlayerName(playerName) && !trackedColor) {
      return sum;
    }

    return sum + game.moves.filter((_, index) => shouldAnalyzeMove(game, index, trackedColor)).length;
  }, 0);
}

function formatCurrentGameLabel(game: ParsedGame, gameIndex: number, totalGames: number): string {
  return `Game ${gameIndex + 1}/${totalGames}: ${game.white} vs ${game.black}`;
}

export async function analyzeGames(
  games: ParsedGame[],
  {
    analyzePosition = defaultAnalyzePosition,
    depth = DEFAULT_DEPTH,
    errorThreshold = DEFAULT_ERROR_THRESHOLD,
    multiPv = DEFAULT_MULTIPV,
    playerName = '',
    onProgress,
  }: AnalyzeGamesOptions = {}
): Promise<AnalyzeGamesResult> {
  const analyzedMoves: AnalyzedMove[] = [];
  const trainingPositions: TrainingPosition[] = [];
  const totalMoves: number = countMovesToAnalyze(games, playerName);
  let nextAnalyzedMoveId = 1;
  let nextTrainingPositionId = 1;
  let processedMoves = 0;

  const reportProgress = (update: Omit<AnalysisProgressUpdate, 'stage'>): void => {
    onProgress?.({
      stage: 'analyzing',
      ...update,
    });
  };

  logAnalysis(
    `start games=${games.length} totalMoves=${totalMoves} depth=${depth} multipv=${multiPv} threshold=${errorThreshold}${
      normalizePlayerName(playerName) ? ` player=${normalizePlayerName(playerName)}` : ''
    }`
  );

  reportProgress({
    processedMoves,
    totalMoves,
    currentGame: '',
    message: totalMoves > 0 ? 'Preparing engine analysis.' : 'No matching moves to analyze.',
  });

  for (const [gameIndex, game] of games.entries()) {
    const sourceGameMetadata: SourceGameMetadata = buildSourceGameMetadata(game);
    const trackedColor = getTrackedColor(game, playerName);
    const currentGame: string = formatCurrentGameLabel(game, gameIndex, games.length);

    if (normalizePlayerName(playerName) && !trackedColor) {
      logAnalysis(
        `game ${gameIndex + 1}/${games.length} ${game.white} vs ${game.black} skipped no player match`
      );
      continue;
    }

    logAnalysis(
      `game ${gameIndex + 1}/${games.length} ${game.white} vs ${game.black} moves=${game.moves.length}${
        trackedColor ? ` trackedColor=${trackedColor}` : ''
      }`
    );

    reportProgress({
      processedMoves,
      totalMoves,
      currentGame,
      message: `Scanning ${currentGame}.`,
    });

    for (const [moveIndex, move] of game.moves.entries()) {
      if (!shouldAnalyzeMove(game, moveIndex, trackedColor)) {
        continue;
      }

      const trackedReplyMove = getTrackedReplyMove(game, moveIndex, trackedColor);
      const moveNumber: number = processedMoves + 1;

      reportProgress({
        processedMoves,
        totalMoves,
        currentGame,
        message: `Analyzing move ${moveNumber} of ${totalMoves}.`,
      });

      logAnalysis(
        `move ${moveNumber}/${totalMoves} game=${gameIndex + 1}/${games.length} ply=${move.plyIndex}/${game.moves.length} color=${move.color} played=${move.san}`
      );

      const preMoveAnalysis: AnalysisResult = await analyzePosition({
        command: 'go',
        fen: move.fenBeforeMove,
        depth,
        multiPv,
        analysisLabel: `${game.id} ply ${move.plyIndex} pre ${move.san}`,
      });

      const actualMoveAnalysis: AnalysisResult =
        preMoveAnalysis.bestMove === move.uci
          ? {
            bestMove: move.uci,
            evaluation: preMoveAnalysis.evaluation,
            evaluationText: preMoveAnalysis.evaluationText,
            principalVariation: preMoveAnalysis.principalVariation,
            multiPv: [
              {
                rank: 1,
                bestMove: move.uci,
                evaluation: preMoveAnalysis.evaluation!,
                evaluationText: preMoveAnalysis.evaluationText!,
                principalVariation: preMoveAnalysis.principalVariation,
              },
            ],
          }
          : await analyzePosition({
            command: 'go',
            fen: move.fenBeforeMove,
            depth,
            multiPv: 1,
            searchMoves: [move.uci],
            analysisLabel: `${game.id} ply ${move.plyIndex} actual ${move.san}`,
          });

      const hasComparableScores: boolean =
        typeof preMoveAnalysis.evaluation === 'number' &&
        typeof actualMoveAnalysis.evaluation === 'number';

      const evalBefore: number | null = hasComparableScores ? roundScore(preMoveAnalysis.evaluation!) : null;
      const evalAfter: number | null = hasComparableScores ? roundScore(actualMoveAnalysis.evaluation!) : null;
      const evalLoss: number | null =
        hasComparableScores && evalBefore !== null && evalAfter !== null
          ? roundScore(Math.max(0, evalBefore - evalAfter))
          : null;
      const severity: string = classifyEvalLoss(evalLoss, errorThreshold);

      const analyzedMove: AnalyzedMove = {
        id: `analyzed-move-${nextAnalyzedMoveId++}`,
        gameId: game.id,
        plyIndex: move.plyIndex,
        moveNumber: move.moveNumber,
        color: move.color,
        fenBeforeMove: move.fenBeforeMove,
        fenAfterMove: move.fenAfterMove,
        playedMove: move.san,
        playedMoveUci: move.uci,
        bestMove: preMoveAnalysis.bestMove,
        bestMoveSan: uciToSan(move.fenBeforeMove, preMoveAnalysis.bestMove),
        evalBefore,
        evalBeforeText: preMoveAnalysis.evaluationText,
        evalAfter,
        evalAfterText: actualMoveAnalysis.evaluationText,
        evalLoss,
        severity,
        principalVariation: preMoveAnalysis.principalVariation,
        multiPv: preMoveAnalysis.multiPv,
        sourceGameMetadata,
      };

      analyzedMoves.push(analyzedMove);

      logAnalysis(
        `move complete game=${gameIndex + 1}/${games.length} ply=${move.plyIndex} best=${analyzedMove.bestMoveSan || analyzedMove.bestMove || 'none'
        } loss=${evalLoss ?? 'n/a'} severity=${severity}`
      );

      if (trackedReplyMove && typeof evalLoss === 'number' && evalLoss >= errorThreshold) {
        // Only after an opponent blunder clears the threshold do we analyze the
        // resulting user-to-move position to build the actual training puzzle.
        const trackedReplyAnalysis: AnalysisResult = await analyzePosition({
          command: 'go',
          fen: trackedReplyMove.fenBeforeMove,
          depth,
          multiPv,
          analysisLabel: `${game.id} ply ${trackedReplyMove.plyIndex} reply ${trackedReplyMove.san}`,
        });

        trainingPositions.push({
          id: `training-position-${nextTrainingPositionId++}`,
          analyzedMoveId: analyzedMove.id,
          fen: trackedReplyMove.fenBeforeMove,
          correctMove: trackedReplyAnalysis.bestMove!,
          correctMoveSan: uciToSan(trackedReplyMove.fenBeforeMove, trackedReplyAnalysis.bestMove),
          playedMove: trackedReplyMove.san,
          playedMoveUci: trackedReplyMove.uci,
          evalLoss,
          severity,
          principalVariation: trackedReplyAnalysis.principalVariation,
          multiPv: trackedReplyAnalysis.multiPv,
          sourceGameMetadata,
        });
      } else if (!trackedColor && typeof evalLoss === 'number' && evalLoss >= errorThreshold) {
        trainingPositions.push({
          id: `training-position-${nextTrainingPositionId++}`,
          analyzedMoveId: analyzedMove.id,
          fen: move.fenBeforeMove,
          correctMove: preMoveAnalysis.bestMove!,
          correctMoveSan: analyzedMove.bestMoveSan,
          playedMove: move.san,
          playedMoveUci: move.uci,
          evalLoss,
          severity,
          principalVariation: preMoveAnalysis.principalVariation,
          multiPv: preMoveAnalysis.multiPv,
          sourceGameMetadata,
        });
      }

      processedMoves += 1;

      reportProgress({
        processedMoves,
        totalMoves,
        currentGame,
        message: `Processed move ${processedMoves} of ${totalMoves}.`,
      });
    }
  }

  trainingPositions.sort((left, right) => {
    if (right.evalLoss !== left.evalLoss) {
      return right.evalLoss - left.evalLoss;
    }

    return left.id.localeCompare(right.id);
  });

  return {
    analyzedMoves,
    trainingPositions,
  };
}
