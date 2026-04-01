import { Chess, Move } from 'chess.js';

export interface NormalizedMove {
  plyIndex: number;
  moveNumber: number;
  color: 'white' | 'black';
  san: string;
  lan: string;
  uci: string;
  from: string;
  to: string;
  promotion: string | null;
  fenBeforeMove: string;
  fenAfterMove: string;
}

export interface ParsedGame {
  id: string;
  sourceFileId: string;
  sourceFilename: string;
  event: string;
  site: string;
  date: string;
  white: string;
  black: string;
  result: string;
  opening: string;
  pgn: string;
  initialFen: string;
  positions: string[];
  moves: NormalizedMove[];
  finalFen: string;
  totalMoves: number;
}

export interface UploadedFile {
  id: string;
  originalFilename: string;
  uploadTimestamp: string;
}

export interface ParseError {
  sourceFileId: string;
  sourceFilename: string;
  gameChunk?: number;
  message: string;
}

export interface ParseUploadedFilesResult {
  uploadedFiles: UploadedFile[];
  games: ParsedGame[];
  errors: ParseError[];
}

export interface MulterLikeFile {
  originalname: string;
  buffer: Buffer;
}

export function splitPgnGames(content: string | null | undefined): string[] {
  const trimmed: string = String(content || '').trim();

  if (!trimmed) {
    return [];
  }

  const chunks: string[] = trimmed
    .split(/\r?\n\r?\n(?=\[Event\s)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.length > 0 ? chunks : [trimmed];
}

export function moveToUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion || ''}`;
}

function normalizeHistory(history: Move[]): NormalizedMove[] {
  return history.map((move, index) => ({
    plyIndex: index + 1,
    moveNumber: Math.floor(index / 2) + 1,
    color: move.color === 'w' ? 'white' as const : 'black' as const,
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

export function parsePgnChunk({ pgn, sourceFileId, sourceFilename, gameId }: {
  pgn: string;
  sourceFileId: string;
  sourceFilename: string;
  gameId: string;
}): ParsedGame {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const headers: Record<string, string> = chess.getHeaders();
  const verboseHistory: Move[] = chess.history({ verbose: true });
  const moves: NormalizedMove[] = normalizeHistory(verboseHistory);
  const initialFen: string = moves[0]?.fenBeforeMove || chess.fen();
  const positions: string[] = [initialFen, ...moves.map((move) => move.fenAfterMove)];

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

export function parseUploadedFiles(files: MulterLikeFile[]): ParseUploadedFilesResult {
  const uploadedFiles: UploadedFile[] = [];
  const games: ParsedGame[] = [];
  const errors: ParseError[] = [];
  let nextGameId = 1;

  files.forEach((file, fileIndex) => {
    const fileId: string = `file-${fileIndex + 1}`;
    const uploadedFile: UploadedFile = {
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

    const content: string = file.buffer.toString('utf8');
    const chunks: string[] = splitPgnGames(content);

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
          message: `Failed to parse game: ${(error as Error).message}`,
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
