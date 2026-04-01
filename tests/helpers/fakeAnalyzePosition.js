const { Chess } = require('chess.js');
const { moveToUci } = require('../../ParsePgn');

async function fakeAnalyzePosition({ fen, multiPv = 3, searchMoves = [] }) {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return {
      bestMove: null,
      evaluation: 0,
      evaluationText: '0.00',
      principalVariation: [],
      multiPv: [],
    };
  }

  const rankedMoves = legalMoves.slice(0, Math.max(multiPv, 1)).map((move, index) => {
    const evaluation = Number((1.8 - index * 0.35).toFixed(2));
    const bestMove = moveToUci(move);

    return {
      rank: index + 1,
      bestMove,
      evaluation,
      evaluationText: evaluation.toFixed(2),
      principalVariation: [bestMove],
    };
  });

  if (searchMoves.length > 0) {
    const searchedMove = searchMoves[0];
    const matchesBest = searchedMove === rankedMoves[0].bestMove;
    const evaluation = matchesBest ? rankedMoves[0].evaluation : 0.25;

    return {
      bestMove: searchedMove,
      evaluation,
      evaluationText: evaluation.toFixed(2),
      principalVariation: [searchedMove],
      multiPv: [
        {
          rank: 1,
          bestMove: searchedMove,
          evaluation,
          evaluationText: evaluation.toFixed(2),
          principalVariation: [searchedMove],
        },
      ],
    };
  }

  return {
    bestMove: rankedMoves[0].bestMove,
    evaluation: rankedMoves[0].evaluation,
    evaluationText: rankedMoves[0].evaluationText,
    principalVariation: rankedMoves[0].principalVariation,
    multiPv: rankedMoves,
  };
}

module.exports = {
  fakeAnalyzePosition,
};
