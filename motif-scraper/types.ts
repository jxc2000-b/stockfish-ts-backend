import { ParsedGame, MulterLikeFile } from '../ParsePgn';

export type ChessSide = 'white' | 'black';

export type MotifName =
  | 'missed_mate'
  | 'hung_piece'
  | 'missed_tactic'
  | 'missed_defense'
  | 'king_safety'
  | 'development'
  | 'bad_trade'
  | 'pawn_structure'
  | 'endgame_technique'
  | 'conversion_failure';

export interface MaterialCounts {
  wp: number;
  wn: number;
  wb: number;
  wr: number;
  wq: number;
  bp: number;
  bn: number;
  bb: number;
  br: number;
  bq: number;
}

export interface PieceSnapshot {
  square: string;
  color: ChessSide;
  type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  value: number;
}

export interface ThreatInfo {
  move: string;
  targetSquare: string | null;
  severity: number;
  isCheck: boolean;
}

export interface TradeAssessment {
  exists: boolean;
  netScore: number;
}

export interface MotifDetectionResult {
  motif: MotifName;
  confidence: number;
  reasons: string[];
}

export interface MotifDetectionSummary {
  motifs: MotifDetectionResult[];
  primaryMotif: MotifDetectionResult | null;
}

export interface MotifDetectionContext {
  fenBeforeMove: string;
  fenAfterMove: string;
  bestMove: string | null;
  playedMove: string | null;
  bestPV: string[];
  actualPV: string[];
  evalBefore: number | null;
  evalAfter: number | null;
  evalLoss: number | null;
  evalBeforeText?: string | null;
  evalAfterText?: string | null;
  phase?: 'opening' | 'middlegame' | 'endgame' | string;
  moveNumber: number;
  castlingRightsBefore?: string | null;
  castlingRightsAfter?: string | null;
  materialBefore?: MaterialCounts;
  materialAfter?: MaterialCounts;
  side: ChessSide;
  opp: ChessSide;
}

export interface ChessComPlayerSummary {
  username?: string;
}

export interface ChessComArchiveGame {
  white?: ChessComPlayerSummary;
  black?: ChessComPlayerSummary;
  rules?: string;
  time_class?: string;
  pgn?: string;
  url?: string;
}

export interface ChessComArchivesPayload {
  archives?: string[];
}

export interface ChessComMonthlyArchivePayload {
  games?: ChessComArchiveGame[];
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> }
) => Promise<FetchLikeResponse>;

export interface MotifScrapeArchiveSummary {
  username: string;
  archiveUrl: string;
  importedGames: number;
}

export interface MotifScrapeResult {
  files: MulterLikeFile[];
  parsedGames: ParsedGame[];
  archiveSummaries: MotifScrapeArchiveSummary[];
  parseErrors: string[];
}

export interface MotifScrapeOptions {
  usernames: string[];
  monthsBack?: number;
  maxGamesPerUser?: number;
  fetchFn?: FetchLike | undefined;
  logger?: (message: string) => void;
}
