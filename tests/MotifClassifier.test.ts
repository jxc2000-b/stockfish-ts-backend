import { AnalyzedMove } from '../AnalyzeGames';
import { classifyAnalyzedMoveMotifs } from '../motif-scraper/classifier';

function createAnalyzedMove(overrides: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    id: 'analyzed-move-1',
    gameId: 'game-1',
    plyIndex: 2,
    moveNumber: 1,
    color: 'black',
    fenBeforeMove: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    fenAfterMove: 'rnbqkbnr/1ppppppp/p7/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    playedMove: 'a6',
    playedMoveUci: 'a7a6',
    bestMove: 'g8f6',
    bestMoveSan: 'Nf6',
    evalBefore: 0.6,
    evalBeforeText: '0.60',
    evalAfter: -0.5,
    evalAfterText: '-0.50',
    evalLoss: 1.1,
    severity: 'inaccuracy',
    principalVariation: ['g8f6', 'd2d4'],
    multiPv: [
      {
        rank: 1,
        bestMove: 'g8f6',
        evaluation: 0.6,
        evaluationText: '0.60',
        principalVariation: ['g8f6', 'd2d4'],
      },
    ],
    sourceGameMetadata: {
      gameId: 'game-1',
      sourceFileId: 'file-1',
      sourceFilename: 'sample.pgn',
      white: 'Student',
      black: 'Coach',
      date: '2026.04.10',
      result: '1-0',
      opening: 'King Pawn Game',
      event: 'Local',
      site: 'Chess.com',
    },
    ...overrides,
  };
}

describe('MotifClassifier', () => {
  test('builds context and runs the detector set through one helper', () => {
    const analyzedMove = createAnalyzedMove();
    const result = classifyAnalyzedMoveMotifs(analyzedMove);

    expect(result.context.playedMove).toBe('a7a6');
    expect(result.context.bestMove).toBe('g8f6');
    expect(result.context.phase).toBe('opening');
    expect(result.motifs.length).toBeGreaterThan(0);
    expect(result.motifs.some((motif) => motif.motif === 'development')).toBe(true);
    expect(result.primaryMotif?.motif).toBe('development');
  });

  test('can restrict classification to a selected motif subset', () => {
    const analyzedMove = createAnalyzedMove();
    const result = classifyAnalyzedMoveMotifs(analyzedMove, {
      selectedMotifs: ['development'],
    });

    expect(result.motifs).toHaveLength(1);
    expect(result.primaryMotif?.motif).toBe('development');
  });
});
