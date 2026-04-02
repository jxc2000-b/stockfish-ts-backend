import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

const ANALYSIS_LOGGING_ENABLED: boolean = process.env.ANALYSIS_LOG !== '0';
const DEFAULT_TIMEOUT_MS: number = Number(process.env.STOCKFISH_ANALYSIS_TIMEOUT_MS || 1000000);

export interface ParsedInfoLine {
  rank: number;
  bestMove: string;
  evaluation: number;
  evaluationText: string;
  principalVariation: string[];
}

export interface AnalysisResult {
  bestMove: string | null;
  evaluation: number | null;
  evaluationText: string | null;
  principalVariation: string[];
  multiPv: ParsedInfoLine[];
}

export interface AnalysisRequest {
  fen: string;
  depth?: number;
  multiPv?: number;
  searchMoves?: string[];
  analysisLabel?: string;
  timeoutMs?: number;
}

export type AnalyzePositionFn = (options: AnalysisRequest) => Promise<AnalysisResult>;

// This logs messages to the console if logging is enabled 

function logStockfish(message: string): void { 
  if (!ANALYSIS_LOGGING_ENABLED) {
    return;
  }

  console.log(`[${new Date().toISOString()}] [stockfish] ${message}`);
}

// normalizes mateIn to between 0-100.
// It stores the sign, takes the magnitude of the number, flattens to 99 and subtracts form 100
// This means that the higher the number is the closer it is to mate, so 99 is mate in 1 

export function normalizeMateScore(mateIn: number): number { 
  const sign: number = Math.sign(mateIn) || 1;
  return sign * (100 - Math.min(Math.abs(mateIn), 99));
}

interface QueuedJob {
  fen: string;
  depth: number;
  multiPv: number;
  searchMoves: string[];
  analysisLabel: string;
  timeoutMs: number;
  resolve: (result: AnalysisResult) => void;
  reject: (error: Error) => void;
}

interface ActiveJob extends QueuedJob {
  startedAt: number;
  phase: 'waiting-ready' | 'searching';
  analysisByRank: Map<number, ParsedInfoLine>;
  timeout: ReturnType<typeof setTimeout>;
}

function createActiveJob(queuedJob: QueuedJob, timeout: ReturnType<typeof setTimeout>): ActiveJob {
  return {
    ...queuedJob,
    startedAt: Date.now(),
    phase: 'waiting-ready',
    analysisByRank: new Map(),
    timeout,
  };
}

function createQueuedJob(options: {
  fen: string;
  depth: number;
  multiPv: number;
  searchMoves: string[];
  analysisLabel: string;
  timeoutMs: number;
  resolve: (result: AnalysisResult) => void;
  reject: (error: Error) => void;
}): QueuedJob {
  return {
    fen: options.fen,
    depth: options.depth,
    multiPv: options.multiPv,
    searchMoves: options.searchMoves,
    analysisLabel: options.analysisLabel,
    timeoutMs: options.timeoutMs,
    resolve: options.resolve,
    reject: options.reject,
  };
}

// Parses the stockfish info line to get values for multipv, eval, bestMove and others 
// scorecp -> "score in centipawns" 100 cp = 1 
// score mate indicates a checkmate has been found
// Pv (line of best moves) is trimmed and split into an array bestmove is gonna be the first move in pv 
// stockfish will either give us a score in centipawns or a mate in X, we handle both and return 

export function parseInfoLine(line: string): ParsedInfoLine | null { 
  const pvMatch: RegExpMatchArray | null = line.match(/\bpv (.+)$/);
  const scoreCpMatch: RegExpMatchArray | null = line.match(/\bscore cp (-?\d+)/);
  const scoreMateMatch: RegExpMatchArray | null = line.match(/\bscore mate (-?\d+)/);

  if (!pvMatch || (!scoreCpMatch && !scoreMateMatch)) {
    return null;
  }

  const rankMatch: RegExpMatchArray | null = line.match(/\bmultipv (\d+)/);
  const principalVariation: string[] = pvMatch[1].trim().split(/\s+/).filter(Boolean);
  const bestMove: string | null = principalVariation[0] || null; //find bestMove with guard

  if (!bestMove) { 
    return null;
  }

  if (scoreCpMatch) { 
    const evaluation: number = Number(scoreCpMatch[1]) / 100; // eval is divided by 100 to convert centipawns to pawns

    return {
      rank: rankMatch ? Number(rankMatch[1]) : 1,
      bestMove,
      evaluation,
      evaluationText: evaluation.toFixed(2),
      principalVariation,
    };
  }

  const mateIn: number = Number(scoreMateMatch![1]);

  return {
    rank: rankMatch ? Number(rankMatch[1]) : 1,
    bestMove,
    evaluation: normalizeMateScore(mateIn),
    evaluationText: `M${mateIn}`,
    principalVariation,
  };
}

//  creates a persistent stockfish worker class with async methods
//  note that in ES6 methods are not declared with any keywords 

export class PersistentStockfishWorker {

  stockfishPath: string;
  engine: ChildProcessWithoutNullStreams | null;
  stdoutBuffer: string;
  stderrBuffer: string;
  uciReady: boolean;
  jobQueue: QueuedJob[];
  currentJob: ActiveJob | null;
  startupPromise: Promise<void> | null;
  startupResolve: (() => void) | null;
  startupReject: ((error: Error) => void) | null;

  constructor({ stockfishPath = process.env.STOCKFISH_PATH || 'stockfish' }: { stockfishPath?: string } = {}) { 
    this.stockfishPath = stockfishPath;
    this.engine = null;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.uciReady = false;
    this.jobQueue = [];
    this.currentJob = null;
    this.startupPromise = null;
    this.startupResolve = null;
    this.startupReject = null;
  }

  // takes the fen and other configs and pushes it into the jobQueue of positions for stockfish to analyze
  // it returns a promise stating the success or failure of analysis on that position

  async analyze({
    fen,
    depth = 10,
    multiPv = 1,
    searchMoves = [],
    analysisLabel = 'position',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: AnalysisRequest): Promise<AnalysisResult> {
    await this.ensureStarted(); //checks or starts engine

    return new Promise<AnalysisResult>((resolve, reject) => {
      this.jobQueue.push(createQueuedJob({
        fen,
        depth,
        multiPv,
        searchMoves,
        analysisLabel,
        timeoutMs,
        resolve,
        reject,
      }));

      this.maybeStartNextJob();
    });
  }

  // this method makes sure that the worker is started and uciready(stockfish "im ready" output) 
  // if the worker is not ready but has a promise to startup we return that if not then the engine is spawned.
  
  async ensureStarted(): Promise<void> {
    if (this.engine && this.uciReady) {
      return;
    }

    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.spawnEngine();
    return this.startupPromise!;
  }

  // this method creates a blank startupPromise
  // it spawns the engine from its path
  // there is also a helper function that helps the stderr variable to store the errors properly as strings
  // there is also one for stdout but with some additional processing
  // what it does is search for the index of the first instance of a newline in the buffer
  // takes out but that newline character as one full line with .slice()
  // removes the line plus the newline from the buffer
  // send the trimmed line to handleEngineLine()
  // search again for the next newline
  // It also sends a spawn message to logStockfish to get logged in the console
  // After that it sends 'uci' (stockfish activiation command) to stockfish

  spawnEngine(): void {
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.uciReady = false;

    this.startupPromise = new Promise<void>((resolve, reject) => {
      this.startupResolve = resolve;
      this.startupReject = reject;
    });

    const engine: ChildProcessWithoutNullStreams = spawn(this.stockfishPath);
    this.engine = engine;

    engine.on('error', (error: Error) => { 
      this.handleEngineFailure(
        new Error(`Failed to start Stockfish at "${this.stockfishPath}": ${error.message}`)
      );
    });

    engine.on('exit', (code: number | null, signal: string | null) => {   //exit code 0 is user terminated or end of process, no cause printed
      if (code === 0 || signal === 'SIGTERM') {
        return;
      }

      this.handleEngineFailure( 
        new Error(
          `Stockfish exited unexpectedly (code: ${code}, signal: ${signal}). ${this.stderrBuffer}`.trim()
        )
      );
    });

    engine.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
    });

    engine.stdout.on('data', (chunk: Buffer) => { 
      this.stdoutBuffer += chunk.toString();
      let newlineIndex: number = this.stdoutBuffer.indexOf('\n');

      while (newlineIndex !== -1) {
        const line: string = this.stdoutBuffer.slice(0, newlineIndex);
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        this.handleEngineLine(line.trim());
        newlineIndex = this.stdoutBuffer.indexOf('\n');
      }
    });

    logStockfish(`spawn worker path=${this.stockfishPath}`);
    engine.stdin.write('uci\n');
  }

  // This function handles possible stockfish line commands in various ways
  // if the line is 'uciok' and the uciReady field is false, thats is, the line
  // worker receives uciok command and uciReady is not already set
  // then it does the following
  // then it marks the Persistent workers uciReady setting as true
  // copies the current resolve function out of the instance field into a local variable
  // clears the instance fields resolve reject and promise
  // it then calls the saved resolve, and maybeStartNextJob()
  //
  // if the line is 'readyok' and the local instance field currentJob's phase is 'waiting-ready'
  // then it passes on the current job to startJobSearch()
  //
  // if the line is one of the various 'info' lines that stockfish gives and the currentJob's phase is 'searching'
  // then it passes the line into parseInfoLine
  // when parsed it sets the currentJobs analysisByRank(of Map() type) field as the parsed rank and parsed line
  //
  // if the line starts with 'bestmove ' and the currentJob's phase is searching then
  // it passes the line into completeCurrentJob()

  handleEngineLine(line: string): void {
    if (!line) {
      return;
    }

    if (line === 'uciok' && !this.uciReady) {
      this.uciReady = true;
      const resolveStartup = this.startupResolve;

      this.startupResolve = null;
      this.startupReject = null;
      this.startupPromise = null;

      resolveStartup?.();
      this.maybeStartNextJob();
      return;
    }

    if (line === 'readyok' && this.currentJob?.phase === 'waiting-ready') {
      this.startJobSearch(this.currentJob);
      return;
    }

    if (line.startsWith('info ') && this.currentJob?.phase === 'searching') {
      const parsed: ParsedInfoLine | null = parseInfoLine(line);

      if (parsed) {
        this.currentJob.analysisByRank.set(parsed.rank, parsed);
      }

      return;
    }

    if (line.startsWith('bestmove ') && this.currentJob?.phase === 'searching') {
      this.completeCurrentJob(line);
    }
  }

  // This function is used to start new jobs, its named maybe- because it doesn't have to
  // it basically adds a new job to the jobQueue
  // it it able to handle cases where jobs dont exits
  // first it makes sure that:
  // the engine exists, that its UCI ready, that the current job exists and that the jobQueue is not zero
  // if it passes the check then it sets the nextJob variable as the first in the jobQueue
  // it then creates a initializes job as a jobQueue object linked to nextJob
  // it sets the start date, phase as 'waiting-ready' its analysisByRank as a blank Map object
  // it sets its timeout field for the job
  // delay: the timeoutMs field of the nextJob
  // func: handleJobTimeout(job) something that kicks in onces a job is timed out
  // after initializing the new job it sets the current job to this new job
  // it then passes a long info message into logStockfish
  // after that it passes two commands:
  // one setting the Multipv value as the multiPV setting og this job
  // and another sending the isready command to stockfish

  maybeStartNextJob(): void {
    if (!this.engine || !this.uciReady || this.currentJob || this.jobQueue.length === 0) {
      return;
    }

    const frontJob: QueuedJob = this.jobQueue.shift()!;
    let activeJob: ActiveJob;
    const timeout = setTimeout(() => {
      this.handleJobTimeout(activeJob);
    }, frontJob.timeoutMs); //don't like this at all 
    activeJob = createActiveJob(frontJob, timeout); 

    this.currentJob = activeJob;

    logStockfish(
      `start ${activeJob.analysisLabel} depth=${activeJob.depth} multipv=${activeJob.multiPv}${
        activeJob.searchMoves.length > 0 ? ` searchmoves=${activeJob.searchMoves.join(',')}` : ''
      } jobQueue=${this.jobQueue.length}`
    );

    this.engine.stdin.write(`setoption name MultiPV value ${activeJob.multiPv}\n`);
    this.engine.stdin.write('isready\n');
  }

  //
  // This function starts a search for each job passes into it
  // first it checks if there is an engine and if the current job is the job passed into it
  // sets the job phase as 'searching'
  // makes sure jobs.SearchMoves exists and sets searchMovesClause to it
  // gives stockfish the position jobs pen and the depth to evaluate at

  startJobSearch(job: ActiveJob): void {
    if (!this.engine || this.currentJob !== job) {
      return;
    }

    job.phase = 'searching';

    const searchMovesClause: string =
      job.searchMoves.length > 0 ? ` searchmoves ${job.searchMoves.join(' ')}` : '';

    this.engine.stdin.write(`position fen ${job.fen}\n`);
    this.engine.stdin.write(`go depth ${job.depth}${searchMovesClause}\n`);
  }

  //
  // This function completes each job with a bestmoveLine
  // first it checks if there is a current job
  // sets job the currentJob
  // sets durationMs as the difference between now and the job's startedAt field
  // sets the fall back best move as the first element in bestmoveLine split into and array by space
  // it sets the orderedMultiPv as the jobs analysisByRank values sorted by rank
  // sets the primary as the number one ranked move in the Pv
  // clears the Timeout
  // and sets currentJob as null
  // logs a done info message with logStockFish
  // it also sets jobs resolve fields based on what it grabbed by stockfish
  // it then calls maybeStartNextJob() to start the next job

  completeCurrentJob(bestmoveLine: string): void {
    if (!this.currentJob) {
      return;
    }

    const job: ActiveJob = this.currentJob;
    const durationMs: number = Date.now() - job.startedAt;
    const fallbackBestMove: string | null = bestmoveLine.split(/\s+/)[1] || null;
    const orderedMultiPv: ParsedInfoLine[] = [...job.analysisByRank.values()].sort((a, b) => a.rank - b.rank);
    const primary: ParsedInfoLine | null = orderedMultiPv.find((entry) => entry.rank === 1) || orderedMultiPv[0] || null;

    clearTimeout(job.timeout);
    this.currentJob = null;

    logStockfish(
      `done ${job.analysisLabel} in ${durationMs}ms best=${primary?.bestMove || fallbackBestMove || 'none'} eval=${
        primary?.evaluationText || 'n/a'
      }`
    );

    job.resolve({
      bestMove: primary?.bestMove || fallbackBestMove,
      evaluation: primary?.evaluation ?? null,
      evaluationText: primary?.evaluationText || null,
      principalVariation: primary?.principalVariation || [],
      multiPv: orderedMultiPv,
    });

    this.maybeStartNextJob();
  }

  //
  // This function first checks if there is a currentJob and it its equal to the job passed into it
  // if there is an error it fails the current job with failCurrentJob
  // it also resets the engine with resetEngine()
  // if the jobQueue is greater than on then it calls ensureStartup() if startup fails then the jobQueue is drained

  handleJobTimeout(job: ActiveJob): void {
    if (!this.currentJob || this.currentJob !== job) {
      return;
    }

    const error = new Error(`Stockfish timed out after ${job.timeoutMs}ms.`);
    this.failCurrentJob(error);
    this.resetEngine();

    if (this.jobQueue.length > 0) {
      this.ensureStarted().catch((startupError: Error) => {
        this.drainQueue(startupError);
      });
    }
  }

  //
  // This function fails the current job in the case of an error
  // First it ensure a current job exists
  // get the jobs duration
  // clears the timeout and logs the fail with logStockFish
  // it then calls the job's reject field with the error

  failCurrentJob(error: Error): void {
    if (!this.currentJob) {
      return;
    }

    const job: ActiveJob = this.currentJob;
    const durationMs: number = Date.now() - job.startedAt;

    clearTimeout(job.timeout);
    this.currentJob = null;

    logStockfish(`fail ${job.analysisLabel} after ${durationMs}ms: ${error.message}`);
    job.reject(error);
  }

  //
  // This function handles engine failure
  // if there is a startupReject then the current reject function out of the instance field
  // into a local variable
  // it clears startupResolve, reject and promise, it does this to make sure startup is finished right away
  // as those values are checked by other functions
  // it then calls the rejectStartup function with it error param
  // if there is a currentJob the it fails the current job with failCurrentJob()
  // it then drains the jobQueue and resets the engine with resetEngine

  handleEngineFailure(error: Error): void {
    if (this.startupReject) {
      const rejectStartup = this.startupReject;

      this.startupResolve = null;
      this.startupReject = null;
      this.startupPromise = null;
      rejectStartup(error);
    }

    if (this.currentJob) {
      this.failCurrentJob(error);
    }

    this.drainQueue(error);
    this.resetEngine();
  }

  //
  // while the jobQueue is not empty it pops off all the jobs and calls the reject function for each job

  drainQueue(error: Error): void {
    while (this.jobQueue.length > 0) {
      const job: QueuedJob = this.jobQueue.shift()!;
      job.reject(error);
    }
  }

  //
  // It removes all listeners such as .on() from both stdout and stderr and itself
  // it kills the child process
  // sets the engine and buffers to null or empty, sets uciReady to false
  // if there is a startupReject then it calls that function and uses it to display an error to the user
  // resets all the startup's Promise values

  resetEngine(): void {
    if (this.engine) {
      this.engine.stdout.removeAllListeners();
      this.engine.stderr.removeAllListeners();
      this.engine.removeAllListeners();
      this.engine.kill();
    }

    this.engine = null;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.uciReady = false;

    if (this.startupReject) {
      const rejectStartup = this.startupReject;
      rejectStartup(new Error('Stockfish worker reset before startup completed.'));
    }

    this.startupResolve = null;
    this.startupReject = null;
    this.startupPromise = null;
  }
  
  //
  // this function drains the jobQueue with drain Queue
  // if there is a current job it fails it with failCurrent job
  // and finally resets the Engine

  shutdown(): void {
    this.drainQueue(new Error('Stockfish worker shut down.'));

    if (this.currentJob) {
      this.failCurrentJob(new Error('Stockfish worker shut down.'));
    }

    this.resetEngine();
  }
}

//
// now outside the class definition for the stockfish worker we initialize a persistent Stockfish worker
// once is an event listener that watched for a particular even which is 'exit' in this case
// once notices the exit action it tells the worker to shutdown
// it also exposes the analyze() method as a function analyzePosition() with options

const worker = new PersistentStockfishWorker();

process.once('exit', () => {
  worker.shutdown();
});

export function analyzePosition(options: AnalysisRequest): Promise<AnalysisResult> {
  return worker.analyze(options);
}
