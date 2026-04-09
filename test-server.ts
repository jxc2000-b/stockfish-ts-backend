import { analyzePosition, stockfishWorker } from './stockfishEngine';

type WorkerRequest = Parameters<typeof analyzePosition>[0];
type WorkerResult = Awaited<ReturnType<typeof analyzePosition>>;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ITALIAN_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const QUEENS_GAMBIT_FEN = 'rnbqkbnr/pp3ppp/2p5/3pp3/3P4/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5';
const ROOK_ENDGAME_FEN = '8/5pk1/3r2p1/3P4/4PK2/6P1/7P/3R4 w - - 0 1';
const TACTICAL_FEN = 'r2q1rk1/ppp2ppp/2npbn2/3Np3/2B1P3/2N5/PPP2PPP/R1BQ1RK1 w - - 2 9';

function createGoJob(
  analysisLabel: string,
  fen: string,
  overrides: Partial<WorkerRequest> = {}
): WorkerRequest {
  return {
    command: 'go',
    analysisLabel,
    fen,
    depth: 8,
    multiPv: 3,
    timeoutMs: 15000,
    ...overrides,
  };
}

function createEvalJob(
  analysisLabel: string,
  fen: string,
  overrides: Partial<WorkerRequest> = {}
): WorkerRequest {
  return {
    command: 'eval',
    analysisLabel,
    fen,
    timeoutMs: 15000,
    ...overrides,
  };
}

function summarizeResult(result: WorkerResult) {
  return {
    bestMove: result.bestMove,
    evaluation: result.evaluation,
    evaluationText: result.evaluationText,
    principalVariation: result.principalVariation.join(' '),
    multiPv: result.multiPv.map((entry) => ({
      rank: entry.rank,
      bestMove: entry.bestMove,
      evaluation: entry.evaluation,
      evaluationText: entry.evaluationText,
      principalVariation: entry.principalVariation.join(' '),
    })),
  };
}

function assertGoResult(label: string, result: WorkerResult): void {
  if (!result.bestMove) {
    throw new Error(`${label} did not return a best move.`);
  }

  if (result.multiPv.length === 0) {
    throw new Error(`${label} did not return any ranked go lines.`);
  }
}

function assertEvalResult(label: string, result: WorkerResult): void {
  if (result.evaluation === null || result.evaluationText === null) {
    throw new Error(`${label} did not return an eval score.`);
  }

  if (result.multiPv.length === 0) {
    throw new Error(`${label} did not store the eval line in multiPv.`);
  }
}

function assertResolutionOrder(name: string, expected: string[], actual: string[]): void {
  if (expected.length !== actual.length) {
    throw new Error(
      `${name} resolved ${actual.length} jobs, expected ${expected.length}.`
    );
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new Error(
        `${name} resolved out of order. Expected ${expected.join(' -> ')}, received ${actual.join(
          ' -> '
        )}.`
      );
    }
  }
}

async function runSingleJobScenario(name: string, request: WorkerRequest) {
  const result = await analyzePosition(request);

  if (request.command === 'go') {
    assertGoResult(request.analysisLabel || name, result);
  } else {
    assertEvalResult(request.analysisLabel || name, result);
  }

  return {
    name,
    submittedLabels: [request.analysisLabel || name],
    resolutionOrder: [request.analysisLabel || name],
    results: [
      {
        label: request.analysisLabel || name,
        command: request.command,
        summary: summarizeResult(result),
      },
    ],
  };
}

async function runQueuedScenario(name: string, requests: WorkerRequest[]) {
  const resolutionOrder: string[] = [];
  const submittedLabels = requests.map((request, index) => request.analysisLabel || `${name}-${index + 1}`);

  const tasks = requests.map((request, index) =>
    analyzePosition(request).then((result) => {
      const label = submittedLabels[index];
      resolutionOrder.push(label);

      if (request.command === 'go') {
        assertGoResult(label, result);
      } else {
        assertEvalResult(label, result);
      }

      return {
        label,
        command: request.command,
        summary: summarizeResult(result),
      };
    })
  );

  const results = await Promise.all(tasks);
  assertResolutionOrder(name, submittedLabels, resolutionOrder);

  return {
    name,
    submittedLabels,
    resolutionOrder,
    results,
  };
}

async function run(): Promise<void> {
  const summary = {
    generatedAt: new Date().toISOString(),
    scenarios: [
      await runSingleJobScenario(
        'single-go-job',
        createGoJob('single-go-job', START_FEN)
      ),
      await runSingleJobScenario(
        'single-eval-job',
        createEvalJob('single-eval-job', ITALIAN_FEN)
      ),
      await runQueuedScenario('queued-go-jobs', [
        createGoJob('queued-go-1', START_FEN),
        createGoJob('queued-go-2', QUEENS_GAMBIT_FEN),
        createGoJob('queued-go-3', ROOK_ENDGAME_FEN),
      ]),
      await runQueuedScenario('queued-go-jobs-with-eval-middle', [
        createGoJob('mixed-go-1', START_FEN),
        createGoJob('mixed-go-2', TACTICAL_FEN),
        createEvalJob('mixed-eval-1', ITALIAN_FEN),
        createGoJob('mixed-go-3', QUEENS_GAMBIT_FEN),
        createGoJob('mixed-go-4', ROOK_ENDGAME_FEN),
      ]),
    ],
  };

  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error: Error) => {
    console.error('\nTest script failed:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    stockfishWorker.shutdown();
  });
