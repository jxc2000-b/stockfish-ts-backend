import { Chess, Move } from 'chess.js';
import {
  ChessSide,
  MaterialCounts,
  MotifDetectionResult,
  PieceSnapshot,
  ThreatInfo,
  TradeAssessment,
} from './types';

const FILES = 'abcdefgh';
const PIECE_VALUES: Record<PieceSnapshot['type'], number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

function getFenParts(fen: string): string[] {
  return String(fen || '').trim().split(/\s+/);
}

function withTurn(fen: string, side: ChessSide): string {
  const parts = getFenParts(fen);

  if (parts.length < 6) {
    throw new Error(`Invalid FEN: ${fen}`);
  }

  parts[1] = side === 'white' ? 'w' : 'b';
  return parts.join(' ');
}

function parseUciMove(uci: string | null | undefined): { from: string; to: string; promotion?: string } | null {
  const match = String(uci || '').trim().match(/^([a-h][1-8])([a-h][1-8])([nbrq])?$/);

  if (!match) {
    return null;
  }

  return {
    from: match[1],
    to: match[2],
    promotion: match[3],
  };
}

function materialPenaltyFromCounts(pawnsByFile: number[]): number {
  let doubledPenalty = 0;
  let isolatedPenalty = 0;
  let islands = 0;

  for (let index = 0; index < pawnsByFile.length; index += 1) {
    const pawnCount = pawnsByFile[index];

    if (pawnCount > 1) {
      doubledPenalty += pawnCount - 1;
    }

    if (pawnCount > 0) {
      const leftHasPawn = index > 0 && pawnsByFile[index - 1] > 0;
      const rightHasPawn = index < pawnsByFile.length - 1 && pawnsByFile[index + 1] > 0;

      if (!leftHasPawn && !rightHasPawn) {
        isolatedPenalty += pawnCount;
      }

      if (index === 0 || pawnsByFile[index - 1] === 0) {
        islands += 1;
      }
    }
  }

  return doubledPenalty + isolatedPenalty + Math.max(0, islands - 1);
}

function getKingSquare(fen: string, side: ChessSide): string | null {
  const king = getPiecesFromFen(fen).find(
    (piece) => piece.color === side && piece.type === 'k'
  );

  return king?.square || null;
}

function getKingNeighborhood(square: string): string[] {
  const fileIndex = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  const neighbors: string[] = [];

  for (let fileOffset = -1; fileOffset <= 1; fileOffset += 1) {
    for (let rankOffset = -1; rankOffset <= 1; rankOffset += 1) {
      if (fileOffset === 0 && rankOffset === 0) {
        continue;
      }

      const nextFileIndex = fileIndex + fileOffset;
      const nextRank = rank + rankOffset;

      if (nextFileIndex < 0 || nextFileIndex >= FILES.length || nextRank < 1 || nextRank > 8) {
        continue;
      }

      neighbors.push(`${FILES[nextFileIndex]}${nextRank}`);
    }
  }

  return neighbors;
}

function getPawnsByFile(fen: string, side: ChessSide): number[] {
  const pawnsByFile = new Array(8).fill(0);

  for (const piece of getPiecesFromFen(fen)) {
    if (piece.color !== side || piece.type !== 'p') {
      continue;
    }

    pawnsByFile[FILES.indexOf(piece.square[0])] += 1;
  }

  return pawnsByFile;
}

function getMaterialScore(material: MaterialCounts, side: ChessSide): number {
  const isWhite = side === 'white';
  const ownPrefix = isWhite ? 'w' : 'b';
  const oppPrefix = isWhite ? 'b' : 'w';

  return (
    9 * (material[`${ownPrefix}q` as keyof MaterialCounts] - material[`${oppPrefix}q` as keyof MaterialCounts]) +
    5 * (material[`${ownPrefix}r` as keyof MaterialCounts] - material[`${oppPrefix}r` as keyof MaterialCounts]) +
    3 * (
      material[`${ownPrefix}n` as keyof MaterialCounts] -
      material[`${oppPrefix}n` as keyof MaterialCounts] +
      material[`${ownPrefix}b` as keyof MaterialCounts] -
      material[`${oppPrefix}b` as keyof MaterialCounts]
    ) +
    1 * (material[`${ownPrefix}p` as keyof MaterialCounts] - material[`${oppPrefix}p` as keyof MaterialCounts])
  );
}

function getMoveFromFen(fen: string, uci: string | null | undefined): Move | null {
  const parsedMove = parseUciMove(uci);

  if (!parsedMove) {
    return null;
  }

  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });

  return (
    legalMoves.find((move) => (
      move.from === parsedMove.from &&
      move.to === parsedMove.to &&
      (parsedMove.promotion ? move.promotion === parsedMove.promotion : true)
    )) || null
  );
}

function getCaptureValue(fen: string, uci: string | null | undefined): number {
  const move = getMoveFromFen(fen, uci);

  if (!move?.captured) {
    return 0;
  }

  return PIECE_VALUES[move.captured as PieceSnapshot['type']] || 0;
}

export function tag(
  motif: MotifDetectionResult['motif'],
  confidence: number,
  reasons: string[]
): MotifDetectionResult {
  return {
    motif,
    confidence,
    reasons,
  };
}

export function countPiecesFromFen(fen: string): MaterialCounts {
  const counts: MaterialCounts = {
    wp: 0,
    wn: 0,
    wb: 0,
    wr: 0,
    wq: 0,
    bp: 0,
    bn: 0,
    bb: 0,
    br: 0,
    bq: 0,
  };

  const board = getFenParts(fen)[0] || '';

  for (const char of board) {
    switch (char) {
      case 'P':
        counts.wp += 1;
        break;
      case 'N':
        counts.wn += 1;
        break;
      case 'B':
        counts.wb += 1;
        break;
      case 'R':
        counts.wr += 1;
        break;
      case 'Q':
        counts.wq += 1;
        break;
      case 'p':
        counts.bp += 1;
        break;
      case 'n':
        counts.bn += 1;
        break;
      case 'b':
        counts.bb += 1;
        break;
      case 'r':
        counts.br += 1;
        break;
      case 'q':
        counts.bq += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

export function getPiecesFromFen(fen: string): PieceSnapshot[] {
  const board = getFenParts(fen)[0] || '';
  const pieces: PieceSnapshot[] = [];
  let rank = 8;
  let fileIndex = 0;

  for (const char of board) {
    if (char === '/') {
      rank -= 1;
      fileIndex = 0;
      continue;
    }

    if (/\d/.test(char)) {
      fileIndex += Number(char);
      continue;
    }

    const type = char.toLowerCase() as PieceSnapshot['type'];
    const color: ChessSide = char === type ? 'black' : 'white';
    const square = `${FILES[fileIndex]}${rank}`;

    pieces.push({
      square,
      color,
      type,
      value: PIECE_VALUES[type],
    });

    fileIndex += 1;
  }

  return pieces;
}

export function applyMove(fen: string, move: string | null | undefined): string | null {
  const parsedMove = parseUciMove(move);

  if (!parsedMove) {
    return null;
  }

  const chess = new Chess(fen);
  const result = chess.move(parsedMove);

  return result ? chess.fen() : null;
}

export function playLine(fen: string, pv: string[], maxPly: number): string | null {
  let currentFen: string | null = fen;

  for (const move of pv.slice(0, maxPly)) {
    currentFen = applyMove(currentFen, move);

    if (!currentFen) {
      return null;
    }
  }

  return currentFen;
}

export function evaluationTextIndicatesMate(value: string | null | undefined): boolean {
  return /^M-?\d+$/i.test(String(value || '').trim());
}

export function lineStartsWithCheck(fen: string, pv: string[]): boolean {
  const nextFen = applyMove(fen, pv[0]);

  if (!nextFen) {
    return false;
  }

  return new Chess(nextFen).inCheck();
}

export function lineStartsWithCheckOrCapture(fen: string, pv: string[]): boolean {
  if (lineStartsWithCheck(fen, pv)) {
    return true;
  }

  return getCaptureValue(fen, pv[0]) > 0;
}

export function materialSwingForSide(
  fen: string,
  pv: string[],
  side: ChessSide,
  maxPly: number
): number {
  const finalFen = playLine(fen, pv, maxPly);

  if (!finalFen) {
    return 0;
  }

  const before = countPiecesFromFen(fen);
  const after = countPiecesFromFen(finalFen);

  return getMaterialScore(after, side) - getMaterialScore(before, side);
}

export function actualPVCapturesAny(pv: string[], pieceSquares: string[]): boolean {
  const watchedSquares = new Set(pieceSquares);

  return pv.some((move) => watchedSquares.has(String(move || '').slice(2, 4)));
}

export function opponentCanWinPieceNextMove(fen: string, square: string): boolean {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });

  return legalMoves.some((move) => move.to === square && Boolean(move.captured));
}

export function findNewLooseOwnPieces(
  fenBefore: string,
  fenAfter: string,
  side: ChessSide
): PieceSnapshot[] {
  const beforeLooseSquares = new Set(
    getPiecesFromFen(fenBefore)
      .filter((piece) => piece.color === side && piece.value > 0)
      .filter((piece) => {
        const attacked = collectLegalMovesForSide(fenBefore, side === 'white' ? 'black' : 'white')
          .some((move) => move.to === piece.square);
        const defended = collectLegalMovesForSide(fenBefore, side)
          .some((move) => move.to === piece.square);

        return attacked && !defended;
      })
      .map((piece) => piece.square)
  );

  return getPiecesFromFen(fenAfter)
    .filter((piece) => piece.color === side && piece.value > 0)
    .filter((piece) => !beforeLooseSquares.has(piece.square))
    .filter((piece) => {
      const attacked = collectLegalMovesForSide(fenAfter, side === 'white' ? 'black' : 'white')
        .some((move) => move.to === piece.square);
      const defended = collectLegalMovesForSide(fenAfter, side)
        .some((move) => move.to === piece.square);

      return attacked && !defended;
    });
}

export function detectImmediateOpponentThreat(fen: string, side: ChessSide): ThreatInfo | null {
  const attackerSide: ChessSide = side === 'white' ? 'black' : 'white';
  const attackerFen = withTurn(fen, attackerSide);
  const legalMoves = collectLegalMovesForSide(attackerFen, attackerSide);
  let bestThreat: ThreatInfo | null = null;

  for (const move of legalMoves) {
    const captureSeverity = move.captured
      ? PIECE_VALUES[move.captured as keyof typeof PIECE_VALUES] || 0
      : 0;
    const nextFen = applyMove(attackerFen, `${move.from}${move.to}${move.promotion || ''}`);
    const isCheck = nextFen ? new Chess(nextFen).inCheck() : false;
    const severity = Math.max(captureSeverity, isCheck ? 2 : 0);

    if (severity <= 0) {
      continue;
    }

    if (!bestThreat || severity > bestThreat.severity) {
      bestThreat = {
        move: `${move.from}${move.to}${move.promotion || ''}`,
        targetSquare: move.to || null,
        severity,
        isCheck,
      };
    }
  }

  return bestThreat;
}

export function moveNeutralizesThreat(
  fen: string,
  move: string | null | undefined,
  threat: ThreatInfo
): boolean {
  const nextFen = applyMove(fen, move);

  if (!nextFen) {
    return false;
  }

  const attackerSide: ChessSide = getSideToMove(fen) === 'white' ? 'black' : 'white';
  const legalReplies = collectLegalMovesForSide(nextFen, attackerSide);

  if (threat.isCheck) {
    const checkingReplyStillExists = legalReplies.some((reply) => {
      const replyFen = applyMove(nextFen, `${reply.from}${reply.to}${reply.promotion || ''}`);
      return replyFen ? new Chess(replyFen).inCheck() : false;
    });

    if (!checkingReplyStillExists) {
      return true;
    }
  }

  if (!threat.targetSquare) {
    return false;
  }

  return !legalReplies.some((reply) => reply.to === threat.targetSquare && Boolean(reply.captured));
}

export function kingSafetyScore(fen: string, side: ChessSide): number {
  const kingSquare = getKingSquare(fen, side);

  if (!kingSquare) {
    return 0;
  }

  const neighborhood = getKingNeighborhood(kingSquare);
  const pieces = getPiecesFromFen(fen);
  const pawnShield = neighborhood.filter((square) =>
    pieces.some((piece) => piece.square === square && piece.color === side && piece.type === 'p')
  ).length;
  const hostilePressure = neighborhood.filter((square) =>
    collectLegalMovesForSide(fen, side === 'white' ? 'black' : 'white').some((move) => move.to === square)
  ).length;

  return pawnShield - hostilePressure;
}

export function opensKingFileOrDiagonal(fenBefore: string, fenAfter: string, side: ChessSide): boolean {
  return kingSafetyScore(fenAfter, side) < kingSafetyScore(fenBefore, side) - 1;
}

export function isDevelopingOrCastling(fen: string, move: string | null | undefined): boolean {
  const parsedMove = parseUciMove(move);

  if (!parsedMove) {
    return false;
  }

  if (
    (parsedMove.from === 'e1' && (parsedMove.to === 'g1' || parsedMove.to === 'c1')) ||
    (parsedMove.from === 'e8' && (parsedMove.to === 'g8' || parsedMove.to === 'c8'))
  ) {
    return true;
  }

  const moveInfo = getMoveFromFen(fen, move);

  if (!moveInfo) {
    return false;
  }

  if (moveInfo.piece === 'n' || moveInfo.piece === 'b') {
    return true;
  }

  return (
    moveInfo.piece === 'p' &&
    ['d', 'e'].includes(parsedMove.from[0]) &&
    ['2', '7'].includes(parsedMove.from[1])
  );
}

export function isNonDevelopingOpeningMove(fen: string, move: string | null | undefined): boolean {
  const moveInfo = getMoveFromFen(fen, move);

  if (!moveInfo) {
    return false;
  }

  if (moveInfo.piece === 'q' || moveInfo.piece === 'r') {
    return true;
  }

  if (moveInfo.piece === 'p') {
    return !['d', 'e'].includes(moveInfo.from[0]);
  }

  return false;
}

export function tradeScore(
  fen: string,
  _move: string | null | undefined,
  pv: string[],
  side: ChessSide
): TradeAssessment {
  const lineMaterialSwing = materialSwingForSide(fen, pv, side, 2);
  const exists = pv.slice(0, 2).some((candidateMove) => getCaptureValue(fen, candidateMove) > 0);

  return {
    exists,
    netScore: lineMaterialSwing,
  };
}

export function pawnStructureScore(fen: string, side: ChessSide): number {
  const pawnsByFile = getPawnsByFile(fen, side);
  return -materialPenaltyFromCounts(pawnsByFile);
}

export function createsNewPawnWeaknesses(fenBefore: string, fenAfter: string, side: ChessSide): boolean {
  return pawnStructureScore(fenAfter, side) < pawnStructureScore(fenBefore, side);
}

export function missedOpposition(
  fenBefore: string,
  bestMove: string | null | undefined,
  playedMove: string | null | undefined
): boolean {
  const pieces = getPiecesFromFen(fenBefore);
  const nonKingPieces = pieces.filter((piece) => piece.type !== 'k' && piece.type !== 'p');

  if (nonKingPieces.length > 0) {
    return false;
  }

  const best = getMoveFromFen(fenBefore, bestMove);
  const played = getMoveFromFen(fenBefore, playedMove);

  return best?.piece === 'k' && played?.piece !== 'k';
}

export function missedKingActivation(
  fenBefore: string,
  bestMove: string | null | undefined,
  playedMove: string | null | undefined
): boolean {
  const best = getMoveFromFen(fenBefore, bestMove);
  const played = getMoveFromFen(fenBefore, playedMove);

  return best?.piece === 'k' && played?.piece !== 'k';
}

export function missedRookBehindPassedPawn(
  fenBefore: string,
  bestMove: string | null | undefined,
  playedMove: string | null | undefined
): boolean {
  const best = getMoveFromFen(fenBefore, bestMove);
  const played = getMoveFromFen(fenBefore, playedMove);

  return best?.piece === 'r' && played?.piece !== 'r';
}

export function missedPawnRace(
  fenBefore: string,
  bestMove: string | null | undefined,
  playedMove: string | null | undefined
): boolean {
  const best = getMoveFromFen(fenBefore, bestMove);
  const played = getMoveFromFen(fenBefore, playedMove);

  return best?.piece === 'p' && played?.piece !== 'p';
}

export function getSideToMove(fen: string): ChessSide {
  return getFenParts(fen)[1] === 'b' ? 'black' : 'white';
}

export function collectLegalMovesForSide(fen: string, side: ChessSide): Move[] {
  return new Chess(withTurn(fen, side)).moves({ verbose: true });
}
