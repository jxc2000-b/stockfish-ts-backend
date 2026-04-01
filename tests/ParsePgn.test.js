const { parseUploadedFiles, splitPgnGames } = require('../ParsePgn');

const sampleMultiGamePgn = `[Event "Game One"]
[Site "Local"]
[Date "2026.03.26"]
[Round "1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0

[Event "Game Two"]
[Site "Local"]
[Date "2026.03.26"]
[Round "1"]
[White "Carol"]
[Black "Dave"]
[Result "0-1"]

1. d4 d5 2. c4 e6 0-1`;

describe('ParsePgn', () => {
  test('splits a multi-game PGN file into separate chunks', () => {
    const chunks = splitPgnGames(sampleMultiGamePgn);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('[Event "Game One"]');
    expect(chunks[1]).toContain('[Event "Game Two"]');
  });

  test('parses uploaded PGNs into normalized games with positions', () => {
    const result = parseUploadedFiles([
      {
        originalname: 'sample-games.pgn',
        buffer: Buffer.from(sampleMultiGamePgn, 'utf8'),
      },
    ]);

    expect(result.uploadedFiles).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.games).toHaveLength(2);

    const firstGame = result.games[0];

    expect(firstGame.white).toBe('Alice');
    expect(firstGame.black).toBe('Bob');
    expect(firstGame.totalMoves).toBe(6);
    expect(firstGame.positions).toHaveLength(firstGame.totalMoves + 1);
    expect(firstGame.moves[0]).toMatchObject({
      plyIndex: 1,
      moveNumber: 1,
      color: 'white',
      san: 'e4',
      uci: 'e2e4',
    });
    expect(firstGame.moves[0].fenBeforeMove).toBe(firstGame.initialFen);
    expect(firstGame.moves[firstGame.moves.length - 1].fenAfterMove).toBe(firstGame.finalFen);
  });
});
