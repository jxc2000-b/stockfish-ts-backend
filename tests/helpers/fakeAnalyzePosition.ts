import { Chess, Move } from 'chess.js';
import { moveToUci } from '../../ParsePgn';
import { analyzePosition as defaultAnalyzePosition, ParsedInfoLine } from '../../stockfishEngine';

type AnalysisRequest = Parameters<typeof defaultAnalyzePosition>[0];
type AnalysisResult = Awaited<ReturnType<typeof defaultAnalyzePosition>>;

export async function fakeAnalyzePosition({ fen, multiPv = 3, searchMoves = [] }: AnalysisRequest): Promise<AnalysisResult> {
  const chess = new Chess(fen);
  const legalMoves: Move[] = chess.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return {
      bestMove: null,
      evaluation: 0,
      evaluationText: '0.00',
      principalVariation: [],
      multiPv: [],
    };
  }

  const rankedMoves: ParsedInfoLine[] = legalMoves.slice(0, Math.max(multiPv, 1)).map((move, index) => {
    const evaluation: number = Number((1.8 - index * 0.35).toFixed(2));
    const bestMove: string = moveToUci(move);

    return {
      rank: index + 1,
      bestMove,
      evaluation,
      evaluationText: evaluation.toFixed(2),
      principalVariation: [bestMove],
    };
  });

  if (searchMoves.length > 0) {
    const searchedMove: string = searchMoves[0];
    const matchesBest: boolean = searchedMove === rankedMoves[0].bestMove;
    const evaluation: number = matchesBest ? rankedMoves[0].evaluation : 0.25;

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
