import { AnalyzedMove } from '../AnalyzeGames';
import { countPiecesFromFen } from './helpers';
import { ChessSide, MaterialCounts, MotifDetectionContext } from './types';

interface BuildContextOptions {
  actualPV?: string[];
  phase?: 'opening' | 'middlegame' | 'endgame';
}

function normalizeSide(color: string): ChessSide {
  if (color === 'white' || color === 'black') {
    return color;
  }

  throw new Error(`Unsupported analyzed move color: ${color}`);
}

function getOpponentSide(side: ChessSide): ChessSide {
  return side === 'white' ? 'black' : 'white';
}

function getBestPv(analyzedMove: AnalyzedMove): string[] {
  const rankedPrimary =
    analyzedMove.multiPv.find((entry) => entry.rank === 1)?.principalVariation || [];

  if (rankedPrimary.length > 0) {
    return rankedPrimary;
  }

  return analyzedMove.principalVariation || [];
}

function getCastlingRights(fen: string): string | null {
  const parts = String(fen || '').trim().split(/\s+/);
  const rights = parts[2] || '-';

  return rights === '-' ? null : rights;
}

function isEndgameMaterial(material: MaterialCounts): boolean {
  const queenCount = material.wq + material.bq;
  const nonQueenMaterial =
    5 * (material.wr + material.br) +
    3 * (material.wn + material.bn + material.wb + material.bb);

  if (queenCount === 0) {
    return nonQueenMaterial <= 20;
  }

  if (queenCount === 1) {
    return nonQueenMaterial <= 14;
  }

  return nonQueenMaterial <= 8;
}

function classifyPhaseFromAnalyzedMove(analyzedMove: AnalyzedMove): 'opening' | 'middlegame' | 'endgame' {
  const materialBefore = countPiecesFromFen(analyzedMove.fenBeforeMove);

  if (isEndgameMaterial(materialBefore)) {
    return 'endgame';
  }

  if (analyzedMove.moveNumber <= 10) {
    return 'opening';
  }

  return 'middlegame';
}

function getActualPv(analyzedMove: AnalyzedMove, actualPV?: string[]): string[] {
  if (Array.isArray(actualPV) && actualPV.length > 0) {
    return actualPV;
  }

  // We do not persist the engine-confirmed played-move PV yet, so the adapter
  // falls back to the actual move itself as the minimum usable line.
  return analyzedMove.playedMoveUci ? [analyzedMove.playedMoveUci] : [];
}

// Convert the backend's analyzed-move record into the common detector context.
// This keeps detector code independent from the current analysis/storage shape.
export function buildMotifDetectionContextFromAnalyzedMove(
  analyzedMove: AnalyzedMove,
  { actualPV, phase }: BuildContextOptions = {}
): MotifDetectionContext {
  const side = normalizeSide(analyzedMove.color);
  const materialBefore = countPiecesFromFen(analyzedMove.fenBeforeMove);
  const materialAfter = countPiecesFromFen(analyzedMove.fenAfterMove);

  return {
    fenBeforeMove: analyzedMove.fenBeforeMove,
    fenAfterMove: analyzedMove.fenAfterMove,
    bestMove: analyzedMove.bestMove,
    playedMove: analyzedMove.playedMoveUci || null,
    bestPV: getBestPv(analyzedMove),
    actualPV: getActualPv(analyzedMove, actualPV),
    evalBefore: analyzedMove.evalBefore,
    evalAfter: analyzedMove.evalAfter,
    evalLoss: analyzedMove.evalLoss,
    evalBeforeText: analyzedMove.evalBeforeText,
    evalAfterText: analyzedMove.evalAfterText,
    phase: phase || classifyPhaseFromAnalyzedMove(analyzedMove),
    moveNumber: analyzedMove.moveNumber,
    castlingRightsBefore: getCastlingRights(analyzedMove.fenBeforeMove),
    castlingRightsAfter: getCastlingRights(analyzedMove.fenAfterMove),
    materialBefore,
    materialAfter,
    side,
    opp: getOpponentSide(side),
  };
}

export { classifyPhaseFromAnalyzedMove };
