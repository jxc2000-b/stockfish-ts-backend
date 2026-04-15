import { MulterLikeFile, parseUploadedFiles } from '../ParsePgn';
import {
  fetchArchiveGames,
  fetchArchiveUrls,
  gameIncludesPlayer,
  isScrapableChessComGame,
  normalizeChessComUsername,
  selectRecentArchiveUrls,
} from './chessComApi';
import {
  ChessComArchiveGame,
  MotifScrapeArchiveSummary,
  MotifScrapeOptions,
  MotifScrapeResult,
} from './types';

function defaultLogger(message: string): void {
  console.log(`[${new Date().toISOString()}] [motif-scraper] ${message}`);
}

function getArchiveMonthLabel(archiveUrl: string): string {
  const match = String(archiveUrl || '').match(/\/games\/(\d{4})\/(\d{2})\/?$/);
  return match ? `${match[1]}-${match[2]}` : 'archive';
}

function createScraperPgnFile(
  username: string,
  archiveUrl: string,
  games: ChessComArchiveGame[]
): MulterLikeFile {
  const monthLabel = getArchiveMonthLabel(archiveUrl);
  const joinedPgn = games
    .map((game) => String(game.pgn || '').trim())
    .filter(Boolean)
    .join('\n\n');

  return {
    originalname: `motif-scraper-${normalizeChessComUsername(username)}-${monthLabel}.pgn`,
    buffer: Buffer.from(joinedPgn, 'utf8'),
  };
}

// This is the first scaffold for the long-running motif scraper. It currently
// handles archive discovery and PGN ingestion so a later pass can plug in
// candidate extraction, engine analysis and motif classification.
export async function scrapeChessComGamesForMotifs({
  usernames,
  monthsBack = 1,
  maxGamesPerUser = Number.POSITIVE_INFINITY,
  fetchFn = globalThis.fetch,
  logger = defaultLogger,
}: MotifScrapeOptions): Promise<MotifScrapeResult> {
  const files: MulterLikeFile[] = [];
  const archiveSummaries: MotifScrapeArchiveSummary[] = [];

  for (const username of usernames.map(normalizeChessComUsername).filter(Boolean)) {
    const archiveUrls = selectRecentArchiveUrls(
      await fetchArchiveUrls(username, fetchFn),
      monthsBack
    );
    let remainingGames = maxGamesPerUser;

    logger(`user=${username} archives=${archiveUrls.length}`);

    for (const archiveUrl of archiveUrls) {
      if (remainingGames <= 0) {
        break;
      }

      const archiveGames = await fetchArchiveGames(archiveUrl, fetchFn);
      const matchingGames = archiveGames
        .filter((game) => gameIncludesPlayer(game, username))
        .filter((game) => isScrapableChessComGame(game))
        .slice(0, remainingGames);

      if (matchingGames.length === 0) {
        continue;
      }

      files.push(createScraperPgnFile(username, archiveUrl, matchingGames));
      archiveSummaries.push({
        username,
        archiveUrl,
        importedGames: matchingGames.length,
      });
      remainingGames -= matchingGames.length;
    }
  }

  const parsedUpload = parseUploadedFiles(files);

  return {
    files,
    parsedGames: parsedUpload.games,
    archiveSummaries,
    parseErrors: parsedUpload.errors.map((error) => `${error.sourceFilename}: ${error.message}`),
  };
}
