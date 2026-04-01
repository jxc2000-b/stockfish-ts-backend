const { Chess } = require('chess.js');

function splitPgnGames(content) {
  const trimmed = String(content || '').trim();

  if (!trimmed) {
    return [];
  }

  const chunks = trimmed
    .split(/\r?\n\r?\n(?=\[Event\s)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.length > 0 ? chunks : [trimmed];
}

function moveToUci(move) {
  return `${move.from}${move.to}${move.promotion || ''}`;
}

function normalizeHistory(history) {
  return history.map((move, index) => ({
    plyIndex: index + 1,
    moveNumber: Math.floor(index / 2) + 1,
    color: move.color === 'w' ? 'white' : 'black',
    san: move.san,
    lan: move.lan,
    uci: moveToUci(move),
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
    fenBeforeMove: move.before,
    fenAfterMove: move.after,
  }));
}

function parsePgnChunk({ pgn, sourceFileId, sourceFilename, gameId }) {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const headers = chess.getHeaders();
  const verboseHistory = chess.history({ verbose: true });
  const moves = normalizeHistory(verboseHistory);
  const initialFen = moves[0]?.fenBeforeMove || chess.fen();
  const positions = [initialFen, ...moves.map((move) => move.fenAfterMove)];

  return {
    id: gameId,
    sourceFileId,
    sourceFilename,
    event: headers.Event || 'Unknown Event',
    site: headers.Site || 'Unknown Site',
    date: headers.Date || 'Unknown Date',
    white: headers.White || 'Unknown Player',
    black: headers.Black || 'Unknown Player',
    result: headers.Result || '*',
    opening: headers.Opening || headers.ECO || 'Unknown Opening',
    pgn: chess.pgn(),
    initialFen,
    positions,
    moves,
    finalFen: positions[positions.length - 1] || initialFen,
    totalMoves: moves.length,
  };
}

function parseUploadedFiles(files) {
  const uploadedFiles = [];
  const games = [];
  const errors = [];
  let nextGameId = 1;

  files.forEach((file, fileIndex) => {
    const fileId = `file-${fileIndex + 1}`;
    const uploadedFile = {
      id: fileId,
      originalFilename: file.originalname,
      uploadTimestamp: new Date().toISOString(),
    };

    uploadedFiles.push(uploadedFile);

    if (!file.originalname.toLowerCase().endsWith('.pgn')) {
      errors.push({
        sourceFileId: fileId,
        sourceFilename: file.originalname,
        message: 'Only .pgn files are allowed.',
      });
      return;
    }

    const content = file.buffer.toString('utf8');
    const chunks = splitPgnGames(content);

    if (chunks.length === 0) {
      errors.push({
        sourceFileId: fileId,
        sourceFilename: file.originalname,
        message: 'The uploaded file did not contain any PGN games.',
      });
      return;
    }

    chunks.forEach((chunk, chunkIndex) => {
      try {
        games.push(
          parsePgnChunk({
            pgn: chunk,
            sourceFileId: fileId,
            sourceFilename: file.originalname,
            gameId: `game-${nextGameId++}`,
          })
        );
      } catch (error) {
        errors.push({
          sourceFileId: fileId,
          sourceFilename: file.originalname,
          gameChunk: chunkIndex + 1,
          message: `Failed to parse game: ${error.message}`,
        });
      }
    });
  });

  return {
    uploadedFiles,
    games,
    errors,
  };
}

module.exports = {
  splitPgnGames,
  moveToUci,
  parsePgnChunk,
  parseUploadedFiles,
};
