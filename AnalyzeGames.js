const { Chess } = require('chess.js');
const { analyzePosition: defaultAnalyzePosition } = require('./StockfishEngine');

const DEFAULT_DEPTH = 10;
const DEFAULT_ERROR_THRESHOLD = 0.8;
const DEFAULT_MULTIPV = 3;
const ANALYSIS_LOGGING_ENABLED = process.env.ANALYSIS_LOG !== '0';

function logAnalysis(message) {
  if (!ANALYSIS_LOGGING_ENABLED) {
    return;
  }

  console.log(`[${new Date().toISOString()}] [analysis] ${message}`);
}

function roundScore(value) {
  return Number(value.toFixed(2));
}

function classifyEvalLoss(evalLoss, errorThreshold = DEFAULT_ERROR_THRESHOLD) {
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

function uciToSan(fen, uci) {
  if (!uci) {
    return null;
  }

  const match = uci.match(/^([a-h][1-8])([a-h][1-8])([nbrq])?$/);

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

function buildSourceGameMetadata(game) {
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

async function analyzeGames(
  games,
  {
    analyzePosition = defaultAnalyzePosition,
    depth = DEFAULT_DEPTH,
    errorThreshold = DEFAULT_ERROR_THRESHOLD,
    multiPv = DEFAULT_MULTIPV,
  } = {}
) {
  const analyzedMoves = [];
  const trainingPositions = [];
  const totalMoves = games.reduce((sum, game) => sum + game.moves.length, 0);
  let nextAnalyzedMoveId = 1;
  let nextTrainingPositionId = 1;
  let processedMoves = 0;

  logAnalysis(
    `start games=${games.length} totalMoves=${totalMoves} depth=${depth} multipv=${multiPv} threshold=${errorThreshold}`
  );

  for (const [gameIndex, game] of games.entries()) {
    const sourceGameMetadata = buildSourceGameMetadata(game);

    logAnalysis(
      `game ${gameIndex + 1}/${games.length} ${game.white} vs ${game.black} moves=${game.moves.length}`
    );

    for (const move of game.moves) {
      processedMoves += 1;

      logAnalysis(
        `move ${processedMoves}/${totalMoves} game=${gameIndex + 1}/${games.length} ply=${move.plyIndex}/${game.moves.length} color=${move.color} played=${move.san}`
      );

      const preMoveAnalysis = await analyzePosition({
        fen: move.fenBeforeMove,
        depth,
        multiPv,
        analysisLabel: `${game.id} ply ${move.plyIndex} pre ${move.san}`,
      });

      const actualMoveAnalysis =
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
                  evaluation: preMoveAnalysis.evaluation,
                  evaluationText: preMoveAnalysis.evaluationText,
                  principalVariation: preMoveAnalysis.principalVariation,
                },
              ],
            }
          : await analyzePosition({
              fen: move.fenBeforeMove,
              depth,
              multiPv: 1,
              searchMoves: [move.uci],
              analysisLabel: `${game.id} ply ${move.plyIndex} actual ${move.san}`,
            });

      const hasComparableScores =
        typeof preMoveAnalysis.evaluation === 'number' &&
        typeof actualMoveAnalysis.evaluation === 'number';

      const evalBefore = hasComparableScores ? roundScore(preMoveAnalysis.evaluation) : null;
      const evalAfter = hasComparableScores ? roundScore(actualMoveAnalysis.evaluation) : null;
      const evalLoss =
        hasComparableScores && evalBefore !== null && evalAfter !== null
          ? roundScore(Math.max(0, evalBefore - evalAfter))
          : null;
      const severity = classifyEvalLoss(evalLoss, errorThreshold);

      const analyzedMove = {
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
          correctMove: preMoveAnalysis.bestMove,
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

module.exports = {
  DEFAULT_DEPTH,
  DEFAULT_ERROR_THRESHOLD,
  DEFAULT_MULTIPV,
  analyzeGames,
  buildSourceGameMetadata,
  classifyEvalLoss,
  roundScore,
  uciToSan,
};
