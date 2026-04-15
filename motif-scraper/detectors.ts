import {
  actualPVCapturesAny,
  createsNewPawnWeaknesses,
  detectImmediateOpponentThreat,
  evaluationTextIndicatesMate,
  findNewLooseOwnPieces,
  kingSafetyScore,
  lineStartsWithCheck,
  lineStartsWithCheckOrCapture,
  materialSwingForSide,
  missedKingActivation,
  missedOpposition,
  missedPawnRace,
  missedRookBehindPassedPawn,
  moveNeutralizesThreat,
  opensKingFileOrDiagonal,
  opponentCanWinPieceNextMove,
  pawnStructureScore,
  tag,
  tradeScore,
  applyMove,
  isDevelopingOrCastling,
  isNonDevelopingOpeningMove,
} from './helpers';
import {
  MotifDetectionContext,
  MotifDetectionResult,
  MotifDetectionSummary,
  MotifName,
} from './types';

export function detectMissedMate(ctx: MotifDetectionContext): MotifDetectionResult | null {
  const bestLineMates = evaluationTextIndicatesMate(ctx.evalBeforeText);
  const playedLineMates = evaluationTextIndicatesMate(ctx.evalAfterText);

  if (!bestLineMates || playedLineMates) {
    return null;
  }

  return tag('missed_mate', 1, [
    'best evaluation indicates a mating line',
    'played line does not preserve the mate',
  ]);
}

export function detectHungPiece(ctx: MotifDetectionContext): MotifDetectionResult | null {
  const newlyLoose = findNewLooseOwnPieces(ctx.fenBeforeMove, ctx.fenAfterMove, ctx.side)
    .filter((piece) => piece.value >= 3)
    .filter((piece) => opponentCanWinPieceNextMove(ctx.fenAfterMove, piece.square));

  if (newlyLoose.length === 0) {
    return null;
  }

  const capturedInLine = actualPVCapturesAny(
    ctx.actualPV,
    newlyLoose.map((piece) => piece.square)
  );

  return tag('hung_piece', capturedInLine ? 0.95 : 0.8, [
    'played move leaves a new loose piece',
    'the opponent can win it immediately',
  ]);
}

export function detectMissedTactic(ctx: MotifDetectionContext): MotifDetectionResult | null {
  const bestGain = materialSwingForSide(ctx.fenBeforeMove, ctx.bestPV, ctx.side, 4);
  const actualGain = materialSwingForSide(ctx.fenBeforeMove, ctx.actualPV, ctx.side, 4);
  const bestIsForcing = lineStartsWithCheckOrCapture(ctx.fenBeforeMove, ctx.bestPV);

  if (!bestIsForcing || bestGain < 2 || actualGain >= bestGain - 1) {
    return null;
  }

  return tag('missed_tactic', 0.85, [
    'best line is forcing',
    'best line wins material or reveals a tactic',
    'played line misses the tactical gain',
  ]);
}

export function detectMissedDefense(ctx: MotifDetectionContext): MotifDetectionResult | null {
  const threat = detectImmediateOpponentThreat(ctx.fenBeforeMove, ctx.side);

  if (!threat) {
    return null;
  }

  if (!moveNeutralizesThreat(ctx.fenBeforeMove, ctx.bestMove, threat)) {
    return null;
  }

  if (moveNeutralizesThreat(ctx.fenBeforeMove, ctx.playedMove, threat)) {
    return null;
  }

  const punished =
    lineStartsWithCheck(ctx.fenAfterMove, ctx.actualPV) ||
    materialSwingForSide(ctx.fenAfterMove, ctx.actualPV, ctx.opp, 3) >= threat.severity;

  if (!punished) {
    return null;
  }

  return tag('missed_defense', 0.9, [
    'opponent had an immediate threat',
    'best move parried it',
    'played move did not',
  ]);
}

export function detectKingSafety(ctx: MotifDetectionContext): MotifDetectionResult | null {
  const beforeScore = kingSafetyScore(ctx.fenBeforeMove, ctx.side);
  const afterScore = kingSafetyScore(ctx.fenAfterMove, ctx.side);
  const bestAfterFen = applyMove(ctx.fenBeforeMove, ctx.bestMove);
  const bestScore = bestAfterFen ? kingSafetyScore(bestAfterFen, ctx.side) : beforeScore;

  if (afterScore >= beforeScore - 2 || afterScore >= bestScore - 1) {
    return null;
  }

  const clearlyUnsafe =
    lineStartsWithCheck(ctx.fenAfterMove, ctx.actualPV) ||
    opensKingFileOrDiagonal(ctx.fenBeforeMove, ctx.fenAfterMove, ctx.side);

  if (!clearlyUnsafe) {
    return null;
  }

  return tag('king_safety', 0.8, [
    'played move weakens the king shelter',
    'best move kept the king safer',
  ]);
}

export function detectDevelopment(ctx: MotifDetectionContext): MotifDetectionResult | null {
  if (ctx.phase !== 'opening' || ctx.moveNumber > 10) {
    return null;
  }

  if (!isDevelopingOrCastling(ctx.fenBeforeMove, ctx.bestMove)) {
    return null;
  }

  if (!isNonDevelopingOpeningMove(ctx.fenBeforeMove, ctx.playedMove)) {
    return null;
  }

  return tag('development', 0.75, [
    'opening phase',
    'best move develops or castles',
    'played move delays development',
  ]);
}

export function detectBadTrade(ctx: MotifDetectionContext): MotifDetectionResult | null {
  const playedTrade = tradeScore(ctx.fenBeforeMove, ctx.playedMove, ctx.actualPV, ctx.side);
  const bestTrade = tradeScore(ctx.fenBeforeMove, ctx.bestMove, ctx.bestPV, ctx.side);

  if (!playedTrade.exists || playedTrade.netScore >= bestTrade.netScore - 1) {
    return null;
  }

  return tag('bad_trade', 0.75, [
    'played move enters an inferior exchange',
    'best move preserves a better trade outcome',
  ]);
}

export function detectPawnStructure(ctx: MotifDetectionContext): MotifDetectionResult | null {
  const beforeScore = pawnStructureScore(ctx.fenBeforeMove, ctx.side);
  const afterScore = pawnStructureScore(ctx.fenAfterMove, ctx.side);
  const bestAfterFen = applyMove(ctx.fenBeforeMove, ctx.bestMove);
  const bestScore = bestAfterFen ? pawnStructureScore(bestAfterFen, ctx.side) : beforeScore;

  if (afterScore >= beforeScore - 2 || afterScore >= bestScore - 1) {
    return null;
  }

  if (!createsNewPawnWeaknesses(ctx.fenBeforeMove, ctx.fenAfterMove, ctx.side)) {
    return null;
  }

  return tag('pawn_structure', 0.7, [
    'played move creates lasting pawn weaknesses',
    'best move avoids the structural damage',
  ]);
}

export function detectEndgameTechnique(ctx: MotifDetectionContext): MotifDetectionResult | null {
  if (ctx.phase !== 'endgame' || (ctx.evalLoss ?? 0) < 0.8) {
    return null;
  }

  const missedTechnique =
    missedOpposition(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove) ||
    missedKingActivation(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove) ||
    missedRookBehindPassedPawn(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove) ||
    missedPawnRace(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove);

  if (!missedTechnique) {
    return null;
  }

  return tag('endgame_technique', 0.85, [
    'endgame phase',
    'best move was technical',
    'played move misses a standard endgame method',
  ]);
}

export function detectConversionFailure(ctx: MotifDetectionContext): MotifDetectionResult | null {
  if ((ctx.evalBefore ?? 0) < 2.5 || (ctx.evalLoss ?? 0) < 1.5 || (ctx.evalAfter ?? 999) > 0.8) {
    return null;
  }

  return tag('conversion_failure', 0.7, [
    'position was clearly better or winning',
    'played move throws away control of the game',
  ]);
}

export const MOTIF_DETECTORS: Array<{
  name: MotifName;
  detect: (ctx: MotifDetectionContext) => MotifDetectionResult | null;
}> = [
  { name: 'missed_mate', detect: detectMissedMate },
  { name: 'hung_piece', detect: detectHungPiece },
  { name: 'missed_defense', detect: detectMissedDefense },
  { name: 'missed_tactic', detect: detectMissedTactic },
  { name: 'king_safety', detect: detectKingSafety },
  { name: 'development', detect: detectDevelopment },
  { name: 'bad_trade', detect: detectBadTrade },
  { name: 'pawn_structure', detect: detectPawnStructure },
  { name: 'endgame_technique', detect: detectEndgameTechnique },
  { name: 'conversion_failure', detect: detectConversionFailure },
];

export function detectMotifs(
  ctx: MotifDetectionContext,
  selectedMotifs?: MotifName[]
): MotifDetectionSummary {
  const selected = selectedMotifs ? new Set(selectedMotifs) : null;
  const motifs = MOTIF_DETECTORS
    .filter((detector) => !selected || selected.has(detector.name))
    .map((detector) => detector.detect(ctx))
    .filter((value): value is MotifDetectionResult => Boolean(value))
    .sort((left, right) => right.confidence - left.confidence);

  return {
    motifs,
    primaryMotif: motifs[0] || null,
  };
}
