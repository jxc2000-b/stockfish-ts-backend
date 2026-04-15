import { AnalyzedMove } from '../AnalyzeGames';
import { buildMotifDetectionContextFromAnalyzedMove } from './contextAdapter';
import { detectMotifs } from './detectors';
import {
  MotifDetectionContext,
  MotifDetectionSummary,
  MotifName,
} from './types';

export interface ClassifyAnalyzedMoveMotifsOptions {
  actualPV?: string[];
  phase?: 'opening' | 'middlegame' | 'endgame';
  selectedMotifs?: MotifName[];
}

export interface ClassifyAnalyzedMoveMotifsResult extends MotifDetectionSummary {
  context: MotifDetectionContext;
}

// This is the shared entry point for motif classification. It keeps callers
// from having to know how to translate backend analysis records into detector
// context before running the detector set.
export function classifyAnalyzedMoveMotifs(
  analyzedMove: AnalyzedMove,
  { actualPV, phase, selectedMotifs }: ClassifyAnalyzedMoveMotifsOptions = {}
): ClassifyAnalyzedMoveMotifsResult {
  const context = buildMotifDetectionContextFromAnalyzedMove(analyzedMove, {
    actualPV,
    phase,
  });
  const summary = detectMotifs(context, selectedMotifs);

  return {
    context,
    motifs: summary.motifs,
    primaryMotif: summary.primaryMotif,
  };
}
