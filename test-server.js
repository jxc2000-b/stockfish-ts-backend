const { analyzeGames } = require('./AnalyzeGames');
const { parseUploadedFiles } = require('./ParsePgn');
const { fakeAnalyzePosition } = require('./tests/helpers/fakeAnalyzePosition');

const samplePgn = `[Event "Training Sample"]
[Site "Local"]
[Date "2026.03.26"]
[Round "1"]
[White "Student"]
[Black "Engine"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 1-0`;

async function run() {
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

  console.log(
    JSON.stringify(
      {
        uploadedFiles: parsed.uploadedFiles,
        errors: parsed.errors,
        totalGames: parsed.games.length,
        games: parsed.games.map((game) => ({
          id: game.id,
          sourceFilename: game.sourceFilename,
          white: game.white,
          black: game.black,
          totalMoves: game.totalMoves,
          initialFen: game.initialFen,
          finalFen: game.finalFen,
        })),
        totalAnalyzedMoves: analysis.analyzedMoves.length,
        totalTrainingPositions: analysis.trainingPositions.length,
        topTrainingPositions: analysis.trainingPositions.slice(0, 5),
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error('\nTest script failed:');
  console.error(error);
  process.exitCode = 1;
});
