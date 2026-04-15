import {
  ChessComArchiveGame,
  ChessComArchivesPayload,
  ChessComMonthlyArchivePayload,
  FetchLike,
  FetchLikeResponse,
} from './types';

const CHESS_COM_API_BASE_URL = 'https://api.chess.com/pub';
const MAX_ARCHIVE_WINDOW_MONTHS = 12;

function createChessComError(message: string, statusCode = 400): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

export function normalizeChessComUsername(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function buildArchivesUrl(username: string): string {
  return `${CHESS_COM_API_BASE_URL}/player/${normalizeChessComUsername(username)}/games/archives`;
}

export function selectRecentArchiveUrls(
  archives: string[] | null | undefined,
  monthsBack = 1
): string[] {
  const archiveUrls = Array.isArray(archives) ? archives.filter(Boolean) : [];
  const windowSize = Math.max(0, Math.min(Number(monthsBack) || 0, MAX_ARCHIVE_WINDOW_MONTHS));

  if (windowSize === 0) {
    return [];
  }

  return archiveUrls.slice(-windowSize).reverse();
}

export function gameIncludesPlayer(game: ChessComArchiveGame, username: string): boolean {
  const normalizedUsername = normalizeChessComUsername(username);

  return (
    normalizeChessComUsername(game.white?.username) === normalizedUsername ||
    normalizeChessComUsername(game.black?.username) === normalizedUsername
  );
}

export function isScrapableChessComGame(game: ChessComArchiveGame): boolean {
  const normalizedTimeClass = String(game.time_class || '').trim().toLowerCase();

  return (
    game.rules === 'chess' &&
    normalizedTimeClass !== 'daily' &&
    typeof game.pgn === 'string' &&
    game.pgn.trim().length > 0
  );
}

async function fetchChessComJson(
  url: string,
  fetchFn: FetchLike | undefined
): Promise<unknown> {
  if (typeof fetchFn !== 'function') {
    throw createChessComError('Fetch is not available in this runtime.', 500);
  }

  let response: FetchLikeResponse;

  try {
    response = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': process.env.CHESSCOM_USER_AGENT || 'Chess-Hyrax motif scraper/0.1',
      },
    });
  } catch (error) {
    throw createChessComError(`Could not reach Chess.com: ${(error as Error).message}`, 502);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw createChessComError('Chess.com username not found.', 404);
    }

    throw createChessComError(`Chess.com request failed with status ${response.status}.`, 502);
  }

  return response.json();
}

export async function fetchArchiveUrls(
  username: string,
  fetchFn: FetchLike | undefined = globalThis.fetch as FetchLike | undefined
): Promise<string[]> {
  const payload = await fetchChessComJson(buildArchivesUrl(username), fetchFn) as ChessComArchivesPayload;
  return Array.isArray(payload.archives) ? payload.archives.filter(Boolean) : [];
}

export async function fetchArchiveGames(
  archiveUrl: string,
  fetchFn: FetchLike | undefined = globalThis.fetch as FetchLike | undefined
): Promise<ChessComArchiveGame[]> {
  const payload = await fetchChessComJson(archiveUrl, fetchFn) as ChessComMonthlyArchivePayload;
  return Array.isArray(payload.games) ? payload.games : [];
}
