const {
  getTrainingSession,
  getTrainingStats,
  recordTrainingAttempt,
  replaceAnalysisData,
  resetStore,
} = require('../TrainingStore');

describe('TrainingStore', () => {
  beforeEach(() => {
    resetStore();
  });

  test('records attempts and summarizes accuracy', () => {
    replaceAnalysisData({
      uploadedFiles: [{ id: 'file-1', originalFilename: 'sample.pgn', uploadTimestamp: 'now' }],
      games: [],
      analyzedMoves: [],
      trainingPositions: [
        {
          id: 'training-position-1',
          correctMove: 'e2e4',
          correctMoveSan: 'e4',
          evalLoss: 1.25,
        },
      ],
    });

    const session = getTrainingSession(1);
    expect(session.positions).toHaveLength(1);

    const result = recordTrainingAttempt({
      trainingPositionId: 'training-position-1',
      userAnswer: 'e2e4',
      responseTimeMs: 1400,
    });

    expect(result.correct).toBe(true);

    const stats = getTrainingStats();
    expect(stats.totalAttempts).toBe(1);
    expect(stats.correctAttempts).toBe(1);
    expect(stats.accuracy).toBe(1);
    expect(stats.attemptsByPosition[0].averageResponseTimeMs).toBe(1400);
  });
});
