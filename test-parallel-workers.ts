import { PersistentStockfishWorker } from './stockfishEngine';

type WorkerRequest = Parameters<PersistentStockfishWorker['createAndStartJobs']>[0];
type WorkerResult = Awaited<ReturnType<PersistentStockfishWorker['createAndStartJobs']>>;

// Reuse a fixed set of positions so sequential and parallel runs are comparable.
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ITALIAN_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const CARO_KANN_FEN = 'rnbqkbnr/pp2pppp/2p5/3p4/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 3';
const QUEENS_GAMBIT_FEN = 'rnbqkbnr/pp3ppp/2p5/3pp3/3P4/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5';
const TACTICAL_FEN = 'r2q1rk1/ppp2ppp/2npbn2/3Np3/2B1P3/2N5/PPP2PPP/R1BQ1RK1 w - - 2 9';
const ROOK_ENDGAME_FEN = '8/5pk1/3r2p1/3P4/4PK2/6P1/7P/3R4 w - - 0 1';
const KINGSAFETY_FEN = 'r1bq1rk1/pp1n1ppp/2pbpn2/3p4/3P4/2NBPN2/PPQ2PPP/R1B2RK1 w - - 0 8';
const PAWN_ENDGAME_FEN = '8/8/3k4/3P4/4K3/8/8/8 w - - 0 1';

function createUserJob(label: string, fen: string): WorkerRequest {
  return {
    command: 'go',
    analysisLabel: label,
    fen,
    depth: 10,
    multiPv: 3,
    timeoutMs: 20000,
  };
}

// Scraper jobs are intentionally lighter and more mixed to resemble a future
// heuristic pipeline that does quick eval passes plus occasional confirmations.
function createScraperEvalJob(label: string, fen: string): WorkerRequest {
  return {
    command: 'eval',
    analysisLabel: label,
    fen,
    timeoutMs: 20000,
  };
}

function createScraperConfirmJob(label: string, fen: string): WorkerRequest {
  return {
    command: 'go',
    analysisLabel: label,
    fen,
    depth: 6,
    multiPv: 1,
    timeoutMs: 20000,
  };
}

function summarizeResult(result: WorkerResult) {
  return {
    bestMove: result.bestMove,
    evaluation: result.evaluation,
    evaluationText: result.evaluationText,
    principalVariation: result.principalVariation.join(' '),
    multiPvCount: result.multiPv.length,
  };
}

function assertGoLikeResult(label: string, result: WorkerResult): void {
  if (result.evaluation === null || result.evaluationText === null) {
    throw new Error(`${label} did not return an evaluation.`);
  }
}

function buildUserJobs(): WorkerRequest[] {
  return [
    createUserJob('user-go-1', START_FEN),
    createUserJob('user-go-2', ITALIAN_FEN),
    createUserJob('user-go-3', CARO_KANN_FEN),
    createUserJob('user-go-4', QUEENS_GAMBIT_FEN),
    createUserJob('user-go-5', TACTICAL_FEN),
    createUserJob('user-go-6', ROOK_ENDGAME_FEN),
  ];
}

function buildScraperJobs(): WorkerRequest[] {
  return [
    createScraperEvalJob('scraper-eval-1', ITALIAN_FEN),
    createScraperEvalJob('scraper-eval-2', KINGSAFETY_FEN),
    createScraperConfirmJob('scraper-go-1', TACTICAL_FEN),
    createScraperEvalJob('scraper-eval-3', PAWN_ENDGAME_FEN),
    createScraperConfirmJob('scraper-go-2', ROOK_ENDGAME_FEN),
    createScraperEvalJob('scraper-eval-4', CARO_KANN_FEN),
  ];
}

// Warm the worker once so startup and UCI handshake overhead does not dominate
// the measurement we care about.
async function warmWorker(worker: PersistentStockfishWorker, label: string): Promise<void> {
  await worker.createAndStartJobs(
    createScraperEvalJob(`${label}-warmup`, START_FEN)
  );
}

// A queue run submits all jobs to one persistent worker and measures the wall
// time that queue takes to drain.
async function runQueue(
  worker: PersistentStockfishWorker,
  queueName: string,
  requests: WorkerRequest[]
): Promise<{
  queueName: string;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  labels: string[];
  results: Array<{ label: string; command: WorkerRequest['command']; summary: ReturnType<typeof summarizeResult> }>;
}> {
  const startedAt = Date.now();
  const results = await Promise.all(
    requests.map(async (request) => {
      const result = await worker.createAndStartJobs(request);
      const label = request.analysisLabel || queueName;
      assertGoLikeResult(label, result);

      return {
        label,
        command: request.command,
        summary: summarizeResult(result),
      };
    })
  );
  const finishedAt = Date.now();

  return {
    queueName,
    durationMs: finishedAt - startedAt,
    startedAt,
    finishedAt,
    labels: requests.map((request) => request.analysisLabel || queueName),
    results,
  };
}

// Baseline: one worker handles both the user-analysis queue and the scraper
// queue back to back.
async function measureSequential(
  userJobs: WorkerRequest[],
  scraperJobs: WorkerRequest[]
) {
  const worker = new PersistentStockfishWorker({
    logger: (message) => console.log(`[baseline] ${message}`),
  });

  try {
    await warmWorker(worker, 'baseline');

    const startedAt = Date.now();
    const userRun = await runQueue(worker, 'baseline-user', userJobs);
    const scraperRun = await runQueue(worker, 'baseline-scraper', scraperJobs);
    const finishedAt = Date.now();

    return {
      mode: 'single-worker-baseline',
      durationMs: finishedAt - startedAt,
      queues: [userRun, scraperRun],
    };
  } finally {
    worker.shutdown();
  }
}

// Parallel case: user analysis and scraper analysis get their own dedicated
// persistent workers and run at the same time.
async function measureParallel(
  userJobs: WorkerRequest[],
  scraperJobs: WorkerRequest[]
) {
  const userWorker = new PersistentStockfishWorker({
    logger: (message) => console.log(`[user-worker] ${message}`),
  });
  const scraperWorker = new PersistentStockfishWorker({
    logger: (message) => console.log(`[scraper-worker] ${message}`),
  });

  try {
    await Promise.all([
      warmWorker(userWorker, 'user-worker'),
      warmWorker(scraperWorker, 'scraper-worker'),
    ]);

    const startedAt = Date.now();
    const [userRun, scraperRun] = await Promise.all([
      runQueue(userWorker, 'user-analysis-queue', userJobs),
      runQueue(scraperWorker, 'scraper-analysis-queue', scraperJobs),
    ]);
    const finishedAt = Date.now();

    // This is only wall-clock overlap, not proof of full CPU saturation.
    const overlapMs = Math.max(
      0,
      Math.min(userRun.finishedAt, scraperRun.finishedAt) -
      Math.max(userRun.startedAt, scraperRun.startedAt)
    );

    return {
      mode: 'dual-worker-parallel',
      durationMs: finishedAt - startedAt,
      overlapMs,
      queues: [userRun, scraperRun],
    };
  } finally {
    userWorker.shutdown();
    scraperWorker.shutdown();
  }
}

async function run(): Promise<void> {
  const userJobs = buildUserJobs();
  const scraperJobs = buildScraperJobs();

  // Compare the "everything through one worker" baseline against the intended
  // architecture where user analysis and scraper analysis are isolated.
  const sequential = await measureSequential(userJobs, scraperJobs);
  const parallel = await measureParallel(userJobs, scraperJobs);
  const speedup = Number((sequential.durationMs / parallel.durationMs).toFixed(2));

  const summary = {
    generatedAt: new Date().toISOString(),
    intent: 'Verify two persistent Stockfish workers can serve different queues on the same host.',
    sequential,
    parallel,
    speedup,
    interpretation:
      parallel.overlapMs > 0
        ? 'Workers overlapped in wall-clock time. Compare durations on the VPS for a realistic CPU-bound result.'
        : 'No measurable overlap was observed in this run.',
  };

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error: Error) => {
  console.error('\nParallel worker verification failed:');
  console.error(error);
  process.exitCode = 1;
});
