import { MulterLikeFile } from './ParsePgn';

const CHESS_COM_API_BASE_URL = 'https://api.chess.com/pub';
export const DEFAULT_TIME_CONTROL = 'rapid';
export const MAX_ARCHIVE_WINDOW_MONTHS = 12;
export const SUPPORTED_TIME_CONTROLS = ['rapid', 'blitz'] as const;

type SupportedTimeControl = typeof SUPPORTED_TIME_CONTROLS[number];

interface ChessComPlayerSummary {
  username?: string;
}

interface ChessComGame {
  white?: ChessComPlayerSummary;
  black?: ChessComPlayerSummary;
  rules?: string;
  time_class?: string;
  pgn?: string;
}

interface ChessComArchivesPayload {
  archives?: string[];
}

interface ChessComMonthlyArchivePayload {
  games?: ChessComGame[];
}

type ChessComImportError = Error & {
  statusCode: number;
};

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<FetchLikeResponse>;

export interface ImportChessComGamesResult {
  files: MulterLikeFile[];
  selectedArchiveUrls: string[];
  importedGamesCount: number;
  timeControls: SupportedTimeControl[];
}

function createChessComImportError(message: string, statusCode = 400): ChessComImportError {
  const error = new Error(message) as ChessComImportError;
  error.statusCode = statusCode;
  return error;
}

export function normalizeChessComUsername(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function normalizeTimeControl(value: string | null | undefined): string {
  return String(value || DEFAULT_TIME_CONTROL)
    .trim()
    .toLowerCase();
}

export function normalizeTimeControls(
  values: string | string[] | null | undefined
): string[] {
  const rawValues = Array.isArray(values) ? values : [values];
  const normalizedValues = [
    ...new Set(rawValues.map((value) => normalizeTimeControl(value)).filter(Boolean)),
  ];

  return normalizedValues.length > 0 ? normalizedValues : [DEFAULT_TIME_CONTROL];
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

function archiveGamesFromPayload(payload: unknown): ChessComGame[] {
  if (Array.isArray((payload as ChessComMonthlyArchivePayload)?.games)) {
    return (payload as ChessComMonthlyArchivePayload).games || [];
  }

  if (Array.isArray(payload)) {
    return payload as ChessComGame[];
  }

  return [];
}

function gameIncludesPlayer(game: ChessComGame, username: string): boolean {
  const normalizedUsername = normalizeChessComUsername(username);
  const whiteUsername = normalizeChessComUsername(game?.white?.username);
  const blackUsername = normalizeChessComUsername(game?.black?.username);

  return whiteUsername === normalizedUsername || blackUsername === normalizedUsername;
}

export function filterMonthlyArchiveGames(
  games: ChessComGame[],
  username: string,
  timeControls: string[] = [DEFAULT_TIME_CONTROL]
): ChessComGame[] {
  const normalizedTimeControls = normalizeTimeControls(timeControls);

  return games.filter((game) => {
    if (!gameIncludesPlayer(game, username)) {
      return false;
    }

    if (game?.rules !== 'chess') {
      return false;
    }

    const gameTimeControl = String(game?.time_class || '')
      .trim()
      .toLowerCase() as SupportedTimeControl;

    if (!gameTimeControl || !normalizedTimeControls.includes(gameTimeControl)) {
      return false;
    }

    if (typeof game?.pgn !== 'string' || !game.pgn.trim()) {
      return false;
    }

    return true;
  });
}

export function getArchiveMonthLabel(archiveUrl: string): string {
  const match = String(archiveUrl || '').match(/\/games\/(\d{4})\/(\d{2})\/?$/);

  if (!match) {
    return 'archive';
  }

  return `${match[1]}-${match[2]}`;
}

export function createSyntheticPgnFile({
  username,
  archiveUrl,
  games,
  timeControls = [DEFAULT_TIME_CONTROL],
}: {
  username: string;
  archiveUrl: string;
  games: ChessComGame[];
  timeControls?: string[];
}): MulterLikeFile {
  const monthLabel = getArchiveMonthLabel(archiveUrl);
  const normalizedUsername = normalizeChessComUsername(username);
  const normalizedTimeControlLabel = normalizeTimeControls(timeControls).join('-');
  const joinedPgn = games.map((game) => String(game.pgn || '').trim()).filter(Boolean).join('\n\n');

  return {
    originalname: `chesscom-${normalizedUsername}-${normalizedTimeControlLabel}-${monthLabel}.pgn`,
    buffer: Buffer.from(joinedPgn, 'utf8'),
  };
}

function getChessComHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': process.env.CHESSCOM_USER_AGENT || 'Chess-Hyrax/0.1 (+local development)',
  };
}

async function fetchChessComJson(
  url: string,
  { fetchFn = globalThis.fetch as FetchLike | undefined }: { fetchFn?: FetchLike | undefined } = {}
): Promise<unknown> {
  if (typeof fetchFn !== 'function') {
    throw createChessComImportError('Fetch is not available in this Node runtime.', 500);
  }

  let response: FetchLikeResponse;

  try {
    response = await fetchFn(url, {
      headers: getChessComHeaders(),
    });
  } catch (error) {
    throw createChessComImportError(`Could not reach Chess.com: ${(error as Error).message}`, 502);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw createChessComImportError('Chess.com username not found.', 404);
    }

    throw createChessComImportError(
      `Chess.com request failed with status ${response.status}.`,
      502
    );
  }

  return response.json();
}

export async function importChessComGames({
  username,
  monthsBack = 1,
  timeControls = [DEFAULT_TIME_CONTROL],
  fetchFn = globalThis.fetch as FetchLike | undefined,
}: {
  username?: string;
  monthsBack?: number;
  timeControls?: string[];
  fetchFn?: FetchLike | undefined;
} = {}): Promise<ImportChessComGamesResult> {
  const normalizedUsername = normalizeChessComUsername(username);
  const normalizedTimeControls = normalizeTimeControls(timeControls);

  if (!normalizedUsername) {
    throw createChessComImportError('Chess.com username is required.');
  }

  if (!Number.isInteger(monthsBack) || monthsBack < 1 || monthsBack > MAX_ARCHIVE_WINDOW_MONTHS) {
    throw createChessComImportError('Unsupported month window.');
  }

  if (
    normalizedTimeControls.some(
      (value) => !SUPPORTED_TIME_CONTROLS.includes(value as SupportedTimeControl)
    )
  ) {
    throw createChessComImportError('Unsupported Chess.com time control.');
  }

  const supportedTimeControls = normalizedTimeControls as SupportedTimeControl[];

  const archivesPayload = (await fetchChessComJson(buildArchivesUrl(normalizedUsername), {
    fetchFn,
  })) as ChessComArchivesPayload;
  const recentArchiveUrls = selectRecentArchiveUrls(archivesPayload?.archives, monthsBack);

  if (recentArchiveUrls.length === 0) {
    throw createChessComImportError('No monthly archives are available for that Chess.com account.');
  }

  const files: MulterLikeFile[] = [];
  const selectedArchiveUrls: string[] = [];
  let importedGamesCount = 0;

  for (const archiveUrl of recentArchiveUrls) {
    const archivePayload = await fetchChessComJson(archiveUrl, { fetchFn });
    const matchingGames = filterMonthlyArchiveGames(
      archiveGamesFromPayload(archivePayload),
      normalizedUsername,
      normalizedTimeControls
    );

    if (matchingGames.length === 0) {
      continue;
    }

    files.push(
      createSyntheticPgnFile({
        username: normalizedUsername,
        archiveUrl,
        games: matchingGames,
        timeControls: supportedTimeControls,
      })
    );
    selectedArchiveUrls.push(archiveUrl);
    importedGamesCount += matchingGames.length;
  }

  if (files.length > 0) {
    return {
      files,
      selectedArchiveUrls,
      importedGamesCount,
      timeControls: supportedTimeControls,
    };
  }

  throw createChessComImportError(
    `No ${supportedTimeControls.join(' / ')} chess games were found for "${normalizedUsername}" in the last ${monthsBack} month${
      monthsBack === 1 ? '' : 's'
    }.`,
    400
  );
}
