import { Chess } from 'chess.js';
import { analyzePositionReadable as defaultAnalyzePosition, ParsedInfoLine } from './stockfishEngineRewrite';
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
}

export interface AnalyzeGamesResult {
  analyzedMoves: AnalyzedMove[];
  trainingPositions: TrainingPosition[];
}

export async function analyzeGames(
  games: ParsedGame[],
  {
    analyzePosition = defaultAnalyzePosition,
    depth = DEFAULT_DEPTH,
    errorThreshold = DEFAULT_ERROR_THRESHOLD,
    multiPv = DEFAULT_MULTIPV,
  }: AnalyzeGamesOptions = {}
): Promise<AnalyzeGamesResult> {
  const analyzedMoves: AnalyzedMove[] = [];
  const trainingPositions: TrainingPosition[] = [];
  const totalMoves: number = games.reduce((sum, game) => sum + game.moves.length, 0);
  let nextAnalyzedMoveId = 1;
  let nextTrainingPositionId = 1;
  let processedMoves = 0;

  logAnalysis(
    `start games=${games.length} totalMoves=${totalMoves} depth=${depth} multipv=${multiPv} threshold=${errorThreshold}`
  );

  for (const [gameIndex, game] of games.entries()) {
    const sourceGameMetadata: SourceGameMetadata = buildSourceGameMetadata(game);

    logAnalysis(
      `game ${gameIndex + 1}/${games.length} ${game.white} vs ${game.black} moves=${game.moves.length}`
    );

    for (const move of game.moves) {
      processedMoves += 1;

      logAnalysis(
        `move ${processedMoves}/${totalMoves} game=${gameIndex + 1}/${games.length} ply=${move.plyIndex}/${game.moves.length} color=${move.color} played=${move.san}`
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
        `move complete game=${gameIndex + 1}/${games.length} ply=${move.plyIndex} best=${
          analyzedMove.bestMoveSan || analyzedMove.bestMove || 'none'
        } loss=${evalLoss ?? 'n/a'} severity=${severity}`
      );

      if (typeof evalLoss === 'number' && evalLoss >= errorThreshold) {
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
