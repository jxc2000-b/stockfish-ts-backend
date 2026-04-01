const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { analyzeGames, DEFAULT_DEPTH, DEFAULT_ERROR_THRESHOLD, DEFAULT_MULTIPV } = require('./AnalyzeGames');
const { parseUploadedFiles } = require('./ParsePgn');
const { analyzePosition } = require('./StockfishEngine');
const {
  getStateSnapshot,
  getTrainingSession,
  getTrainingStats,
  recordTrainingAttempt,
  replaceAnalysisData,
} = require('./TrainingStore');

const app = express();
const PORT = process.env.PORT || 5001;

const analysisConfig = {
  depth: DEFAULT_DEPTH,
  errorThreshold: DEFAULT_ERROR_THRESHOLD,
  multiPv: DEFAULT_MULTIPV,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 5 * 1024 * 1024,
  },
});

const trainingSessionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const trainingAttemptBodySchema = z.object({
  trainingPositionId: z.union([z.string(), z.number()]).transform((value) => String(value)),
  userAnswer: z.string().trim().min(1),
  responseTimeMs: z.coerce.number().int().min(0),
});

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    analysisConfig,
    stockfishPath: process.env.STOCKFISH_PATH || 'stockfish',
  });
});

app.post('/api/upload-pgns', upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Upload at least one PGN file.' });
    }

    console.log(
      `[${new Date().toISOString()}] [upload] received ${req.files.length} file(s): ${req.files
        .map((file) => file.originalname)
        .join(', ')}`
    );

    const invalidFiles = req.files.filter(
      (file) => !file.originalname.toLowerCase().endsWith('.pgn')
    );

    if (invalidFiles.length > 0) {
      return res.status(400).json({
        error: 'Only .pgn files are allowed.',
        invalidFiles: invalidFiles.map((file) => file.originalname),
      });
    }

    const parsedUpload = parseUploadedFiles(req.files);

    console.log(
      `[${new Date().toISOString()}] [upload] parsed games=${parsedUpload.games.length} parseErrors=${parsedUpload.errors.length}`
    );

    if (parsedUpload.games.length === 0) {
      return res.status(400).json({
        error: 'No valid PGN games were parsed from the upload.',
        uploadedFiles: parsedUpload.uploadedFiles,
        errors: parsedUpload.errors,
      });
    }

    const analysis = await analyzeGames(parsedUpload.games, {
      analyzePosition,
      ...analysisConfig,
    });

    console.log(
      `[${new Date().toISOString()}] [upload] analysis complete analyzedMoves=${analysis.analyzedMoves.length} trainingPositions=${analysis.trainingPositions.length}`
    );

    replaceAnalysisData({
      uploadedFiles: parsedUpload.uploadedFiles,
      uploadErrors: parsedUpload.errors,
      games: parsedUpload.games,
      analyzedMoves: analysis.analyzedMoves,
      trainingPositions: analysis.trainingPositions,
    });

    return res.json({
      uploadedFiles: parsedUpload.uploadedFiles,
      errors: parsedUpload.errors,
      games: parsedUpload.games,
      analyzedMoves: analysis.analyzedMoves,
      trainingPositions: analysis.trainingPositions,
      trainingSession: getTrainingSession(),
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/training-session', (req, res, next) => {
  try {
    const { limit } = trainingSessionQuerySchema.parse(req.query);

    res.json(getTrainingSession(limit));
  } catch (error) {
    next(error);
  }
});

app.post('/api/training-attempts', (req, res, next) => {
  try {
    const body = trainingAttemptBodySchema.parse(req.body);
    const result = recordTrainingAttempt(body);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/training-stats', (_req, res) => {
  res.json(getTrainingStats());
});

app.get('/api/state', (_req, res) => {
  res.json(getStateSnapshot());
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Each PGN file must be 5MB or smaller.' });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Upload between 1 and 10 PGN files.' });
    }

    return res.status(400).json({ error: error.message });
  }

  if (error instanceof z.ZodError) {
    return res.status(400).json({
      error: 'Invalid request payload.',
      details: error.flatten(),
    });
  }

  if (typeof error.message === 'string' && error.message.startsWith('Unknown training position:')) {
    return res.status(404).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({
    error: 'Internal server error.',
    details: error.message,
  });
});

module.exports = {
  app,
  analysisConfig,
};

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}
