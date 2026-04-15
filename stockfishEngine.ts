import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

const ANALYSIS_LOGGING_ENABLED: boolean = process.env.ANALYSIS_LOG !== '0';
const DEFAULT_TIMEOUT_MS: number = Number(process.env.STOCKFISH_ANALYSIS_TIMEOUT_MS || 1000000);
const DEFAULT_DEPTH = 10;
const DEFAULT_MULTIPV = 1;
const STDERR_TAIL_LIMIT = 4000;

function defaultLogger(message: string): void {
    if (!ANALYSIS_LOGGING_ENABLED) {
        return;
    }

    console.log(`[${new Date().toISOString()}] stockfish: ${message}`)
}

interface StockfishJob {
    id: number,
    timeoutMs: number;
    fen: string;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
}

interface GoJob extends StockfishJob {
    command: "go";
    depth: number;
    multiPv: number;
    searchMoves: string[];
    analysisLabel: string;
}

interface EvalJob extends StockfishJob {
    command: "eval";
    searchMoves: string[];
    analysisLabel: string;

}

interface Request {
    fen: string;
    command: "eval" | "go",
    depth?: number;
    multiPv?: number;
    searchMoves?: string[];
    analysisLabel?: string;
    timeoutMs?: number;
}

export interface ParsedInfoLine {
    rank: number;
    bestMove: string | null;
    evaluation: number;
    evaluationText: string;
    principalVariation: string[];
}

interface Result {
    bestMove: string | null;
    evaluation: number | null;
    evaluationText: string | null;
    principalVariation: string[];
    multiPv: ParsedInfoLine[];
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'];
    let reject!: Deferred<T>['reject'];

    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });

    return { promise, resolve, reject };
}

function makeJobActive(queuedJob: StockfishJob, timeout: ReturnType<typeof setTimeout>): any {
    return {
        ...queuedJob,
        startedAt: Date.now(),
        phase: 'waiting-ready',
        analysisByRank: new Map(),
        timeout,
    }
}

function normalizeMateScore(mateIn: number): number {
    const sign: number = Math.sign(mateIn) || 1;
    return sign * (100 - Math.min(Math.abs(mateIn), 99));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(1, Math.floor(value));
}

function appendTail(existing: string, addition: string, maxLength = STDERR_TAIL_LIMIT): string {
    const next = `${existing}${addition}`;
    return next.length > maxLength ? next.slice(-maxLength) : next;
}

function formatSearchMovesClause(searchMoves: string[]): string {
    return searchMoves.length > 0 ? ` searchmoves ${searchMoves.join(' ')}` : '';
}

export function parseInfoLine(line: string): ParsedInfoLine | null {
    //matches
    const pvMatch: RegExpMatchArray | null = line.match(/\bpv (.+)$/);
    const scoreCpMatch: RegExpMatchArray | null = line.match(/\bscore cp (-?\d+)/);
    const scoreMateMatch: RegExpMatchArray | null = line.match(/\bscore mate (-?\d+)/);
    const rankMatch: RegExpMatchArray | null = line.match(/\bmultipv (\d+)/);
    const evalMatch: RegExpMatchArray | null = line.match(/NNUE evaluation\s+([+-]\d+(?:.\d+)?)/);

    //no match guard
    if (!pvMatch && !scoreCpMatch && !scoreMateMatch && !evalMatch) {
        return null;
    }

    //derived from matches 
    const principalVariation: string[] = pvMatch ? pvMatch[1].trim().split(/\s+/).filter(Boolean) : [];
    const bestMove: string | null = principalVariation[0] || null; //find bestMove with guard

    if (evalMatch) {
        const evaluation: number = Number(evalMatch[1]);
        return {
            rank: 1,
            bestMove: null,
            evaluation,
            evaluationText: evaluation.toFixed(2),
            principalVariation: [],
        }
    }

    if (!bestMove) {
        defaultLogger(`Problem deriving bestmove from pv match`)
        return null;
    }

    if (scoreCpMatch) {
        const evaluation = Number(scoreCpMatch[1]) / 100;
        return {
            rank: rankMatch ? Number(rankMatch[1]) : 1,
            bestMove,
            evaluation,
            evaluationText: evaluation.toFixed(2),
            principalVariation,
        }
    }

    if (scoreMateMatch) {
        const mateIn = Number(scoreMateMatch![1]);
        return {
            rank: rankMatch ? Number(rankMatch[1]) : 1,
            bestMove,
            evaluation: normalizeMateScore(mateIn),
            evaluationText: `M${mateIn}`,
            principalVariation,
        }
    }

    return null;
}

interface StockFishWorkerOptions {
    stockfishPath?: string;
    logger?: (message: string) => void;
    defaultTimeoutMs?: number;
    spawnProcess?: typeof spawn;
}

export class PersistentStockfishWorker {
    stockfishPath: string;
    log: (message: string) => void;
    defaultTimeoutMs: number;
    spawnProcess: typeof spawn;

    engine: ChildProcessWithoutNullStreams | null = null;
    stdoutBuffer: string = '';
    stderrBuffer: string = '';
    isUciReady: boolean = false;
    jobQueue: Array<EvalJob | GoJob> = [];
    activeJob: any | null = null;
    startup: Deferred<void> | null = null;
    nextJobId = 1;

    constructor({
        stockfishPath = process.env.STOCKFISH_PATH || 'stockfish',
        logger = defaultLogger,
        defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
        spawnProcess = spawn
    }: StockFishWorkerOptions = {}) {
        this.stockfishPath = stockfishPath;
        this.log = logger;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.spawnProcess = spawnProcess
    }

    async createAndStartJobs(jobRequest: Request): Promise<any> {
        const normalizedRequest = this.ensureFenAndCommandPresent(jobRequest);

        await this.ensureEngineStarted();
        return new Promise<any>((resolve, reject) => {
            this.jobQueue.push(
                this.createQueuedJob(
                    normalizedRequest,
                    resolve,
                    reject
                )
            );
            this.startNextJob();
        });
    }

    private createQueuedJob(
        request: Request,
        resolve: (result: any) => void,
        reject: (error: Error) => void
    ): EvalJob | GoJob {
        switch (request.command) {
            case "eval":
                return {
                    ...request,
                    id: this.nextJobId++,
                    command: "eval",
                    fen: request.fen,
                    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                    searchMoves: request.searchMoves ?? [],
                    analysisLabel: request.analysisLabel ?? 'position',
                    resolve,
                    reject,
                };

            case "go":
                return {
                    ...request,
                    id: this.nextJobId++,
                    command: "go",
                    fen: request.fen,
                    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                    searchMoves: request.searchMoves ?? [],
                    analysisLabel: request.analysisLabel ?? 'position',
                    depth: normalizePositiveInteger(request.depth, DEFAULT_DEPTH),
                    multiPv: normalizePositiveInteger(request.multiPv, DEFAULT_MULTIPV),
                    resolve,
                    reject,
                };
        }
    }

    private startNextJob(): void {
        if (!this.engine || !this.isUciReady || this.activeJob || this.jobQueue.length === 0) {
            return;
        }
        const nextJob = this.jobQueue.shift()!;
        const timeout = setTimeout(() => {
            this.handleJobTimeout(nextJob.id);
        }, nextJob.timeoutMs);
        const activeJob = makeJobActive(nextJob, timeout)

        this.activeJob = activeJob
        switch (this.activeJob.command) {
            case 'go':
                this.log(
                    `start ${activeJob.analysisLabel} depth=${activeJob.depth} multipv=${activeJob.multiPv}${activeJob.searchMoves.length > 0 ?
                        ` searchmoves=${activeJob.searchMoves.join(',')}`
                        : ''
                    } queue=${this.jobQueue.length}`
                );

                this.engine.stdin.write(`setoption name MultiPV value ${activeJob.multiPv}\n`);
                this.engine.stdin.write('isready\n');
                break;
            case 'eval':
                this.log(
                    `start ${activeJob.analysisLabel} ${activeJob.searchMoves.length > 0 ?
                        ` searchmoves=${activeJob.searchMoves.join(',')}`
                        : ''
                    } queue=${this.jobQueue.length}`
                );
                this.engine.stdin.write('isready\n');
                break;
        }
    }

    // These completion paths still share most of their structure and could be unified later.
    completeActiveGoJob(bestmoveLine: string): void {
        if (!this.activeJob) {
            return;
        }

        const job = this.activeJob;
        clearTimeout(job.timeout);
        this.activeJob = null;

        const durationMs: number = Date.now() - job.startedAt;
        const fallbackBestMove: string | null = bestmoveLine.split(/\s+/)[1] || null;
        const orderedMultiPv: ParsedInfoLine[] = [...job.analysisByRank.values()].sort((a, b) => a.rank - b.rank);
        const primary: ParsedInfoLine | null = orderedMultiPv.find((entry) => entry.rank === 1) || orderedMultiPv[0] || null;

        this.log(
            `done ${job.analysisLabel} in ${durationMs}ms best=${primary?.bestMove || fallbackBestMove || 'none'} eval=${primary?.evaluationText || 'n/a'
            }`
        );

        const result: Result = {
            bestMove: primary?.bestMove || fallbackBestMove,
            evaluation: primary?.evaluation ?? null,
            evaluationText: primary?.evaluationText || null,
            principalVariation: primary?.principalVariation || [],
            multiPv: orderedMultiPv,
        };
        job.resolve(result);
        this.startNextJob();
    }

    private completeEvalJob(): void {
        if (!this.activeJob) {
            return;
        }

        const job = this.activeJob;
        clearTimeout(job.timeout);
        this.activeJob = null;

        const durationMs: number = Date.now() - job.startedAt;
        const orderedMultiPv: ParsedInfoLine[] = [...job.analysisByRank.values()].sort((a, b) => a.rank - b.rank);
        const primary: ParsedInfoLine | null = orderedMultiPv.find((entry) => entry.rank === 1) || orderedMultiPv[0] || null;

        this.log(
            `done ${job.analysisLabel} in ${durationMs}ms best=${primary?.bestMove || 'none'} eval=${primary?.evaluationText || 'n/a'
            }`
        );

        const result: Result = {
            bestMove: null,
            evaluation: primary?.evaluation ?? null,
            evaluationText: primary?.evaluationText || null,
            principalVariation: primary?.principalVariation || [],
            multiPv: orderedMultiPv,
        };

        job.resolve(result);
        this.startNextJob();
    }

    private startJobs(job: any): void {
        if (!this.engine || this.activeJob !== job) {
            return;
        }
        if (job.command === 'eval') {
            job.phase = 'searching';

            this.engine.stdin.write(`position fen ${job.fen}\n`);
            this.engine.stdin.write(`eval\n`);
        }
        else {
            job.phase = 'searching';
            const searchMovesClause: string =
                job.searchMoves.length > 0 ? ` searchmoves ${job.searchMoves.join(' ')}` : '';

            this.engine.stdin.write(`position fen ${job.fen}\n`);
            this.engine.stdin.write(`go depth ${job.depth}${searchMovesClause}\n`);
        }
    }

    private ensureFenAndCommandPresent(request: Request): Request {
        const normalizedFen = String(request.fen || '').trim();

        if (!normalizedFen) {
            throw new Error('FEN is required for analysis.');
        }

        if (request.command !== "go" && request.command !== "eval") {
            throw new Error('Command is required for analysis');
        }

        return {
            ...request,
            fen: normalizedFen,
        };
    }

    //engine
    private async ensureEngineStarted(): Promise<void> {
        if (this.engine && this.isUciReady) {
            return;
        }
        if (this.startup) {
            return this.startup.promise;
        }
        this.startEngine();
        return this.startup!.promise
    }

    private startEngine(): void {
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.isUciReady = false;

        this.startup = createDeferred<void>();

        const engine: ChildProcessWithoutNullStreams = this.spawnProcess(this.stockfishPath)
        this.engine = engine

        engine.on('error', (error: Error) => {
            this.handleEngineFailure(new Error(`Failed to start Stockfish at "${this.stockfishPath}": ${error.message}`))
        });

        engine.on('exit', (code: number | null, signal: string | null) => {
            if (this.engine !== engine) {
                return;
            }
            this.handleEngineFailure(
                new Error(
                    `Stockfish exited unexpectedly (code: ${code}, signal: ${signal}). ${this.stderrBuffer}`.trim()
                )
            )
        });

        engine.stderr.on('data', (chunk: Buffer) => {
            this.stderrBuffer = appendTail(this.stderrBuffer, chunk.toString());
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

        this.log(`spawn worker path=${this.stockfishPath}`);
        engine.stdin.write('uci\n');
    }

    private handleEngineLine(line: string): void {
        if (!line) {
            return;
        }

        if (line === 'uciok' && !this.isUciReady) {
            this.isUciReady = true;
            this.resolveStartup();
            this.startNextJob();
            return;
        }

        if (line === 'readyok' && this.activeJob?.phase === 'waiting-ready') {
            this.startJobs(this.activeJob);
            return;
        }

        if (line.startsWith('info ') && this.activeJob?.phase === 'searching') {
            const parsed = parseInfoLine(line);
            if (!parsed || !this.activeJob) {
                return;
            }
            this.activeJob.analysisByRank.set(parsed.rank, parsed);
            return;
        }

        if (line.startsWith('bestmove ') && this.activeJob?.phase === 'searching') {
            this.completeActiveGoJob(line);
            return;
        }

        if (line.startsWith('NNUE evaluation') && this.activeJob?.phase === 'searching' && this.activeJob?.command === 'eval') {
            const parsed = parseInfoLine(line);

            if (!parsed || !this.activeJob) {
                this.failActiveJob(new Error(`Failed to parse eval output: ${line}`));
                this.resetEngine();
                return;
            }

            this.activeJob.analysisByRank.set(parsed.rank, parsed);
            this.completeEvalJob();
            return;
        }
    }

    private handleJobTimeout(jobId: number): void {
        if (this.activeJob?.id !== jobId) {
            return;
        }

        this.failActiveJob(new Error(`Stockfish timed out after ${this.activeJob.timeoutMs}ms.`));
        this.resetEngine();

        if (this.jobQueue.length > 0) {
            this.ensureEngineStarted().catch((startupError: Error) => {
                this.drainQueue(startupError);
            });
        }
    }

    private handleEngineFailure(error: Error): void {
        this.rejectStartup(error);
        this.failActiveJob(error);
        this.drainQueue(error);
        this.resetEngine();
    }

    private failActiveJob(error: Error): void {
        const job = this.activeJob;

        if (!job) {
            return;
        }

        this.activeJob = null;
        clearTimeout(job.timeout);

        const durationMs = Date.now() - job.startedAt;
        this.log(`fail ${job.analysisLabel} after ${durationMs}ms: ${error.message}`);
        job.reject(error);
    }

    private resolveStartup(): void {
        if (!this.startup) {
            return;
        }

        const startup = this.startup;
        this.startup = null;
        startup.resolve();
    }

    private rejectStartup(error: Error): void {
        if (!this.startup) {
            return;
        }

        const startup = this.startup;
        this.startup = null;
        this.isUciReady = false;
        startup.reject(error);
    }

    private drainQueue(error: Error): void {
        while (this.jobQueue.length > 0) {
            const job: StockfishJob = this.jobQueue.shift()!;
            job.reject(error);
        }
    }

    private resetEngine(): void {
        const engine = this.engine;
        this.engine = null;
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.isUciReady = false;

        if (!engine) {
            return;
        }

        engine.stdout.removeAllListeners();
        engine.stderr.removeAllListeners();
        engine.removeAllListeners();

        if (!engine.killed) {
            engine.kill();
        }

        this.rejectStartup(new Error('Stockfish worker reset before startup completed.'));
    }

    shutdown(): void {
        this.drainQueue(new Error('Stockfish worker shut down.'));

        if (this.activeJob) {
            this.failActiveJob(new Error('Stockfish worker shut down.'));
        }

        this.resetEngine();
    }
}

export const stockfishWorker = new PersistentStockfishWorker();

process.once('exit', () => {
    stockfishWorker.shutdown();
});

export function analyzePosition(options: Request): Promise<Result> {
    return stockfishWorker.createAndStartJobs(options);
}
