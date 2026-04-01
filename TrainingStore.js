/**
 * @typedef {Object} state
 * @property {object[]} uploadedFiles
 * @property {object[]} uploadErrors
 * @property {object[]} games
 * @property {object[]} analyzedMoves
 * @property {object[]} trainingPositions
 * @property {object[]} trainingAttempts
 * @property {number} nextAttemptId
 */

/**
 * @typedef {object} trainingAttempt
 * @property {string} id
 * @property {string} userAnswer
 * @property {Boolean} correct
 * @property {number} responseTimeMs
 * @property {string} attemptedAt
 */

/**
 * @typedef {object} trainingPosition
 * @property {string} id
 * @property {string} analyzedMoveId
 * @property {string} fen
 * @property {string} correctMove
 * @property {string|null} correctMoveSan
 * @property {string} playedMove
 * @property {string} playedMoveUci
 * @property {number} evalLoss
 * @property {string} severity
 * @property {string[]} principalVariation
 * @property {object[]} multiPv
 * @property {object} sourceGameMetadata
 */

const state = {
  uploadedFiles: [],
  uploadErrors: [],
  games: [],
  analyzedMoves: [],
  /**@type {trainingPosition[]} */
  trainingPositions: [], //array of positions user will play
  /**@type {trainingAttempt[]} */
  trainingAttempts: [], //
  nextAttemptId: 1,
};

//resets state
function resetStore() {
  state.uploadedFiles = [];
  state.uploadErrors = [];
  state.games = [];
  state.analyzedMoves = [];
  state.trainingPositions = [];
  state.trainingAttempts = [];
  state.nextAttemptId = 1;
}

//clears analysisData (different shape from state)
function replaceAnalysisData({
  uploadedFiles = [],
  uploadErrors = [],
  games = [],
  analyzedMoves = [],
  trainingPositions = [],
}) {
  state.uploadedFiles = structuredClone(uploadedFiles);
  state.uploadErrors = structuredClone(uploadErrors);
  state.games = structuredClone(games);
  state.analyzedMoves = structuredClone(analyzedMoves);
  state.trainingPositions = structuredClone(trainingPositions);
  state.trainingAttempts = [];
  state.nextAttemptId = 1;
}


function getTrainingPositionById(trainingPositionId) {
  return state.trainingPositions.find((position) => position.id === String(trainingPositionId));
}

//gets array of 20 training positions
function getTrainingSession(limit = 20) {
  return structuredClone({
    totalPositions: state.trainingPositions.length,
    positions: state.trainingPositions.slice(0, limit),
  });
}

// removes whitespaces, changes characters to lowercase and removes '+' and '#' 
function normalizeAnswer(answer) {
  return String(answer || '')
    .trim()
    .toLowerCase()
    .replace(/[+#]+$/g, '');
}


function recordTrainingAttempt({ trainingPositionId, userAnswer, responseTimeMs }) {
  const trainingPosition = getTrainingPositionById(trainingPositionId);

  if (!trainingPosition) { //ensure position exists
    throw new Error(`Unknown training position: ${trainingPositionId}`);
  }

  const normalizedAnswer = normalizeAnswer(userAnswer); //sanitizing
  const correct =
    normalizedAnswer === normalizeAnswer(trainingPosition.correctMove) ||
    normalizedAnswer === normalizeAnswer(trainingPosition.correctMoveSan);

  const attempt = { //store attempt 
    id: `attempt-${state.nextAttemptId++}`,
    trainingPositionId: trainingPosition.id,
    userAnswer, // this 
    correct,
    responseTimeMs, //and this are defensive against bad inputs
    attemptedAt: new Date().toISOString(),
  };

  state.trainingAttempts.push(attempt); //push to state

  return {
    correct,
    correctMove: trainingPosition.correctMove,
    correctMoveSan: trainingPosition.correctMoveSan,
    attempt,
  };
}

function getTrainingStats() {
  const totalAttempts = state.trainingAttempts.length;
  const correctAttempts = state.trainingAttempts.filter((attempt) => attempt.correct).length;
  const accuracy = totalAttempts > 0 ? Number((correctAttempts / totalAttempts).toFixed(2)) : 0;

  const attemptsByPosition = state.trainingPositions.map((position) => { // nested scan scales badly with memory
    const attempts = state.trainingAttempts.filter(
      (attempt) => attempt.trainingPositionId === position.id
    );
    const averageResponseTimeMs = 
      attempts.length > 0
        ? Math.round(
            attempts.reduce((sum, attempt) => sum + attempt.responseTimeMs, 0) / attempts.length
          )
        : null; //avg response kinda useless

    return {
      trainingPositionId: position.id,
      evalLoss: position.evalLoss,
      attempts: attempts.length,
      correctAttempts: attempts.filter((attempt) => attempt.correct).length,
      averageResponseTimeMs,
    };
  });

  return {
    totalUploadedFiles: state.uploadedFiles.length,
    totalGames: state.games.length,
    totalAnalyzedMoves: state.analyzedMoves.length,
    totalTrainingPositions: state.trainingPositions.length,
    totalAttempts,
    correctAttempts,
    accuracy,
    attemptsByPosition,
  };
}

function getStateSnapshot() {
  return {
    uploadedFiles: state.uploadedFiles,
    uploadErrors: state.uploadErrors,
    games: state.games,
    analyzedMoves: state.analyzedMoves,
    trainingPositions: state.trainingPositions,
    trainingAttempts: state.trainingAttempts,
  };
}

module.exports = {
  getStateSnapshot,
  getTrainingPositionById,
  getTrainingSession,
  getTrainingStats,
  recordTrainingAttempt,
  replaceAnalysisData,
  resetStore,
};
