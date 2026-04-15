# Motif Classification Notes

These notes capture the current design direction for move-motif classification in the JS backend so the work can be resumed later without re-deriving the approach.

## Modeling Direction

- Keep `severity` and `mistakeType` separate.
- `severity` answers "how bad was the move?" and remains eval-loss based.
- `mistakeType` answers "what high-level category does this belong to?" and can give special categories like `miss` precedence before falling back to `severity`.
- Add `motifs` as a separate, multi-label classification layer.
- Add `context` such as `phase`, `moveNumber`, `timeControl`, `openingFamily`, and color so recurring errors can be bundled meaningfully.

This gives a structure like:

- `severity`
- `mistakeType`
- `motifs[]`
- `primaryMotif`
- `phase`
- `context`

## Input Context For Motif Detectors

Each motif detector should receive a common `ctx` object:

```js
{
  (fenBeforeMove, fenAfterMove, bestMove, playedMove, bestPV, actualPV, evalBefore, evalAfter, evalLoss, phase, moveNumber, castlingRightsBefore, castlingRightsAfter, materialBefore, materialAfter, side, opp);
}
```

## Helper Layer

Detectors assume a helper layer with utilities like:

```js
applyMove(fen, move);
lineEndsInMate(fen, pv, maxPly);
lineStartsWithCheck(fen, pv);
lineStartsWithCheckOrCapture(fen, pv);
materialSwingForSide(fen, pv, side, maxPly);
findNewLooseOwnPieces(fenBefore, fenAfter, side);
opponentCanWinPieceNextMove(fen, square);
actualPVCapturesAny(pv, pieceSquares);
detectImmediateOpponentThreat(fen, side);
moveNeutralizesThreat(fen, move, threat);
kingSafetyScore(fen, side);
opensKingFileOrDiagonal(fenBefore, fenAfter, side);
isDevelopingOrCastling(fen, move);
isNonDevelopingOpeningMove(fen, move);
tradeScore(fen, move, pv, side);
pawnStructureScore(fen, side);
createsNewPawnWeaknesses(fenBefore, fenAfter, side);
missedOpposition(fenBefore, bestMove, playedMove);
missedKingActivation(fenBefore, bestMove, playedMove);
missedRookBehindPassedPawn(fenBefore, bestMove, playedMove);
missedPawnRace(fenBefore, bestMove, playedMove);
tag(name, confidence, reasons);
```

For performance-sensitive helpers like material counting or endgame detection, prefer direct FEN parsing over spinning up `chess.js` unless board semantics are required.

## Detector Shape

Each detector should return either `null` or a result object:

```js
{
  motif: 'hung_piece',
  confidence: 0.8,
  reasons: ['played move leaves a loose minor piece']
}
```

Recommended execution pattern:

```js
const detectors = [detectMissedMate, detectHungPiece, detectMissedDefense, detectMissedTactic, detectKingSafety, detectDevelopment, detectBadTrade, detectPawnStructure, detectEndgameTechnique, detectConversionFailure];

// Missed_Defense, Missed_Tactic, King_Safety, Development, Bad_Trade, Pawn_Structure, Endgame_Technique

const motifs = detectors.map((fn) => fn(ctx)).filter(Boolean);
const primaryMotif = motifs.sort((a, b) => b.confidence - a.confidence)[0] || null;
```

## Motif Pseudocode

### `missed_mate`

```js
function detectMissedMate(ctx) {
  const bestLineMates = lineEndsInMate(ctx.fenBeforeMove, ctx.bestPV, 6);
  const playedLineMates = lineEndsInMate(ctx.fenBeforeMove, ctx.actualPV, 6);

  if (!bestLineMates) return null;
  if (playedLineMates) return null;

  return tag("missed_mate", 1.0, ["best PV ends in mate", "played line does not preserve mate"]);
}
```

### `hung_piece`

```js
function detectHungPiece(ctx) {
  const newlyLoose = findNewLooseOwnPieces(ctx.fenBeforeMove, ctx.fenAfterMove, ctx.side)
    .filter((piece) => piece.value >= 3)
    .filter((piece) => opponentCanWinPieceNextMove(ctx.fenAfterMove, piece.square));

  if (newlyLoose.length === 0) return null;

  const capturedInLine = actualPVCapturesAny(
    ctx.actualPV,
    newlyLoose.map((piece) => piece.square),
  );

  return tag("hung_piece", capturedInLine ? 0.95 : 0.8, ["played move leaves a new loose piece", "opponent can win it immediately"]);
}
```

### `missed_tactic`

```js
function detectMissedTactic(ctx) {
  const bestGain = materialSwingForSide(ctx.fenBeforeMove, ctx.bestPV, ctx.side, 4);
  const actualGain = materialSwingForSide(ctx.fenBeforeMove, ctx.actualPV, ctx.side, 4);
  const bestIsForcing = lineStartsWithCheckOrCapture(ctx.fenBeforeMove, ctx.bestPV);

  if (!bestIsForcing) return null;
  if (bestGain < 2) return null;
  if (actualGain >= bestGain - 1) return null;

  return tag("missed_tactic", 0.85, ["best line is forcing", "best line wins material or reveals a tactic", "played line misses the tactical gain"]);
}
```

### `missed_defense`

```js
function detectMissedDefense(ctx) {
  const threat = detectImmediateOpponentThreat(ctx.fenBeforeMove, ctx.side);

  if (!threat) return null;
  if (!moveNeutralizesThreat(ctx.fenBeforeMove, ctx.bestMove, threat)) return null;
  if (moveNeutralizesThreat(ctx.fenBeforeMove, ctx.playedMove, threat)) return null;

  const punished = lineStartsWithCheck(ctx.fenAfterMove, ctx.actualPV) || materialSwingForSide(ctx.fenAfterMove, ctx.actualPV, ctx.opp, 3) >= threat.severity;

  if (!punished) return null;

  return tag("missed_defense", 0.9, ["opponent had an immediate threat", "best move parried it", "played move did not"]);
}
```

### `king_safety`

```js
function detectKingSafety(ctx) {
  const beforeScore = kingSafetyScore(ctx.fenBeforeMove, ctx.side);
  const afterScore = kingSafetyScore(ctx.fenAfterMove, ctx.side);
  const bestAfterFen = applyMove(ctx.fenBeforeMove, ctx.bestMove);
  const bestScore = kingSafetyScore(bestAfterFen, ctx.side);

  if (afterScore >= beforeScore - 2) return null;
  if (afterScore >= bestScore - 1) return null;

  const clearlyUnsafe = lineStartsWithCheck(ctx.fenAfterMove, ctx.actualPV) || opensKingFileOrDiagonal(ctx.fenBeforeMove, ctx.fenAfterMove, ctx.side);

  if (!clearlyUnsafe) return null;

  return tag("king_safety", 0.8, ["played move weakens king shelter", "best move kept the king safer"]);
}
```

### `development`

```js
function detectDevelopment(ctx) {
  if (ctx.phase !== "opening") return null;
  if (ctx.moveNumber > 10) return null;
  if (!isDevelopingOrCastling(ctx.fenBeforeMove, ctx.bestMove)) return null;
  if (!isNonDevelopingOpeningMove(ctx.fenBeforeMove, ctx.playedMove)) return null;

  return tag("development", 0.75, ["opening phase", "best move develops or castles", "played move delays development"]);
}
```

### `bad_trade`

```js
function detectBadTrade(ctx) {
  const playedTrade = tradeScore(ctx.fenBeforeMove, ctx.playedMove, ctx.actualPV, ctx.side);
  const bestTrade = tradeScore(ctx.fenBeforeMove, ctx.bestMove, ctx.bestPV, ctx.side);

  if (!playedTrade.exists) return null;
  if (playedTrade.netScore >= bestTrade.netScore - 1) return null;

  return tag("bad_trade", 0.75, ["played move enters an inferior exchange", "best move preserves a better trade outcome"]);
}
```

### `pawn_structure`

```js
function detectPawnStructure(ctx) {
  const beforeScore = pawnStructureScore(ctx.fenBeforeMove, ctx.side);
  const afterScore = pawnStructureScore(ctx.fenAfterMove, ctx.side);
  const bestAfterFen = applyMove(ctx.fenBeforeMove, ctx.bestMove);
  const bestScore = pawnStructureScore(bestAfterFen, ctx.side);

  if (afterScore >= beforeScore - 2) return null;
  if (afterScore >= bestScore - 1) return null;
  if (!createsNewPawnWeaknesses(ctx.fenBeforeMove, ctx.fenAfterMove, ctx.side)) return null;

  return tag("pawn_structure", 0.7, ["played move creates lasting pawn weaknesses", "best move avoids the structural damage"]);
}
```

### `endgame_technique`

```js
function detectEndgameTechnique(ctx) {
  if (ctx.phase !== "endgame") return null;
  if (ctx.evalLoss < 0.8) return null;

  const missedTechnique = missedOpposition(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove) || missedKingActivation(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove) || missedRookBehindPassedPawn(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove) || missedPawnRace(ctx.fenBeforeMove, ctx.bestMove, ctx.playedMove);

  if (!missedTechnique) return null;

  return tag("endgame_technique", 0.85, ["endgame phase", "best move was technical", "played move misses a standard endgame method"]);
}
```

### `conversion_failure`

```js
function detectConversionFailure(ctx) {
  if (ctx.evalBefore < 2.5) return null;
  if (ctx.evalLoss < 1.5) return null;
  if (ctx.evalAfter > 0.8) return null;

  return tag("conversion_failure", 0.7, ["position was clearly better or winning", "played move throws away control of the game"]);
}
```

## Extra Motifs Worth Considering Later

- `trapped_piece`
- `missed_intermezzo`
- `simplification_error`
- `passed_pawn_race`
- `stalemate_blunder`

These can be added as separate detectors without changing the overall architecture.

## Notes On Phase Classification

- `opening` should be based mostly on move number.
- `endgame` should be based on material from direct FEN parsing, not total game length.
- `middlegame` is the fallback between those two.

The current heuristic direction:

- use `moveNumber` for opening detection
- parse piece counts from the FEN directly for endgame detection
- avoid `chess.js` for simple material counting because direct FEN scanning is cheaper

## Next Implementation Direction

When this work resumes:

1. Create a dedicated motif-classification module rather than bloating `AnalyzeGames.js`.
2. Start with broad motifs and confidence scores.
3. Store `motifs[]`, `primaryMotif`, and `motifConfidence` on analyzed moves and training positions.
4. Keep severity, mistake type, and motifs as separate axes.
5. Use motifs for future user-facing bundles like "missed forks in middlegames" rather than grouping by eval loss alone.
