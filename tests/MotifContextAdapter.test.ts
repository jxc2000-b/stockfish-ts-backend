import { buildMotifDetectionContextFromAnalyzedMove, classifyPhaseFromAnalyzedMove } from '../motif-scraper/contextAdapter';
import { AnalyzedMove } from '../AnalyzeGames';

function createAnalyzedMove(overrides: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    id: 'analyzed-move-1',
    gameId: 'game-1',
    plyIndex: 6,
    moveNumber: 3,
    color: 'black',
    fenBeforeMove: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 2 3',
    fenAfterMove: 'r1bqkbnr/pppp1ppp/8/4p3/2n1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
    playedMove: 'Nc4',
    playedMoveUci: 'c6c4',
    bestMove: 'g8f6',
    bestMoveSan: 'Nf6',
    evalBefore: 0.82,
    evalBeforeText: '0.82',
    evalAfter: -0.41,
    evalAfterText: '-0.41',
    evalLoss: 1.23,
    severity: 'mistake',
    principalVariation: ['g8f6', 'd2d3', 'f8c5'],
    multiPv: [
      {
        rank: 1,
        bestMove: 'g8f6',
        evaluation: 0.82,
        evaluationText: '0.82',
        principalVariation: ['g8f6', 'd2d3', 'f8c5'],
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
      opening: 'Italian Game',
      event: 'Local',
      site: 'Chess.com',
    },
    ...overrides,
  };
}

describe('MotifContextAdapter', () => {
  test('builds detector context from an analyzed move with sensible defaults', () => {
    const analyzedMove = createAnalyzedMove();
    const context = buildMotifDetectionContextFromAnalyzedMove(analyzedMove);

    expect(context.fenBeforeMove).toBe(analyzedMove.fenBeforeMove);
    expect(context.fenAfterMove).toBe(analyzedMove.fenAfterMove);
    expect(context.bestMove).toBe('g8f6');
    expect(context.playedMove).toBe('c6c4');
    expect(context.bestPV).toEqual(['g8f6', 'd2d3', 'f8c5']);
    expect(context.actualPV).toEqual(['c6c4']);
    expect(context.side).toBe('black');
    expect(context.opp).toBe('white');
    expect(context.phase).toBe('opening');
    expect(context.castlingRightsBefore).toBe('KQkq');
    expect(context.castlingRightsAfter).toBe('KQkq');
    expect(context.materialBefore?.wq).toBe(1);
    expect(context.materialAfter?.bn).toBe(2);
  });

  test('uses override values for phase and actual pv when supplied', () => {
    const analyzedMove = createAnalyzedMove({
      moveNumber: 22,
    });

    const context = buildMotifDetectionContextFromAnalyzedMove(analyzedMove, {
      phase: 'middlegame',
      actualPV: ['c6c4', 'c4d2'],
    });

    expect(context.phase).toBe('middlegame');
    expect(context.actualPV).toEqual(['c6c4', 'c4d2']);
  });

  test('classifies sparse material positions as endgames', () => {
    const analyzedMove = createAnalyzedMove({
      moveNumber: 38,
      fenBeforeMove: '8/5pk1/3r2p1/3P4/4PK2/6P1/7P/3R4 w - - 0 1',
      fenAfterMove: '8/5pk1/3r2p1/3P4/4PK2/6P1/3R3P/8 b - - 1 1',
    });

    expect(classifyPhaseFromAnalyzedMove(analyzedMove)).toBe('endgame');
  });
});
