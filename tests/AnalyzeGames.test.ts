import { analyzeGames } from '../AnalyzeGames';
import { parseUploadedFiles } from '../ParsePgn';
import { fakeAnalyzePosition } from './helpers/fakeAnalyzePosition';

const samplePgn = `[Event "Training Sample"]
[Site "Local"]
[Date "2026.03.26"]
[Round "1"]
[White "Student"]
[Black "Coach"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 1-0`;

describe('AnalyzeGames', () => {
  test('analyzes every move and extracts training positions above threshold', async () => {
    const parsed = parseUploadedFiles([
      {
        originalname: 'training-sample.pgn',
        buffer: Buffer.from(samplePgn, 'utf8'),
      },
    ]);

    const analysis = await analyzeGames(parsed.games, {
      analyzePosition: fakeAnalyzePosition,
      depth: 22,
      errorThreshold: 0.8,
      multiPv: 3,
    });

    expect(analysis.analyzedMoves).toHaveLength(parsed.games[0].moves.length);
    expect(analysis.trainingPositions.length).toBeGreaterThan(0);
    expect(analysis.trainingPositions[0].evalLoss).toBeGreaterThanOrEqual(0.8);
    expect(analysis.trainingPositions[0].multiPv.length).toBeGreaterThan(0);
    expect(analysis.trainingPositions[0].sourceGameMetadata.white).toBe('Student');

    const analyzedMovesById = new Map(
      analysis.analyzedMoves.map((move) => [move.id, move])
    );
    for (const trainingPosition of analysis.trainingPositions) {
      const currentMove = analyzedMovesById.get(trainingPosition.analyzedMoveId);

      expect(currentMove).toBeDefined();
      expect(trainingPosition.fen).toBe(currentMove!.fenBeforeMove);
      expect(trainingPosition.correctMove).toBe(currentMove!.bestMove);
      expect(trainingPosition.evalLoss).toBe(currentMove!.evalLoss);
      expect(trainingPosition.severity).toBe(currentMove!.severity);
      expect(trainingPosition.evalLoss).toBeGreaterThanOrEqual(0.8);
    }

    for (let index = 1; index < analysis.trainingPositions.length; index += 1) {
      expect(analysis.trainingPositions[index - 1].evalLoss).toBeGreaterThanOrEqual(
        analysis.trainingPositions[index].evalLoss
      );
    }
  });

  test('limits training positions to the opponent turns when playerName is provided', async () => {
    const parsed = parseUploadedFiles([
      {
        originalname: 'training-sample.pgn',
        buffer: Buffer.from(samplePgn, 'utf8'),
      },
    ]);

    const analysis = await analyzeGames(parsed.games, {
      analyzePosition: fakeAnalyzePosition,
      depth: 22,
      errorThreshold: 0.8,
      multiPv: 3,
      playerName: 'student',
    });

    expect(analysis.analyzedMoves).toHaveLength(parsed.games[0].moves.length);
    expect(analysis.trainingPositions.length).toBeGreaterThan(0);

    const analyzedMovesById = new Map(analysis.analyzedMoves.map((move) => [move.id, move]));

    for (const trainingPosition of analysis.trainingPositions) {
      const currentMove = analyzedMovesById.get(trainingPosition.analyzedMoveId);

      expect(currentMove).toBeDefined();
      expect(currentMove!.color).toBe('black');
      expect(trainingPosition.fen).toBe(currentMove!.fenBeforeMove);
      expect(trainingPosition.evalLoss).toBe(currentMove!.evalLoss);
    }
  });
});
