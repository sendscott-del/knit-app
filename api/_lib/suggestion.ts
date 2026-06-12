/**
 * Shim — the engine lives in shared/suggestion.ts, the single source of
 * truth also consumed by src/lib/suggestion.ts (admin app). This file used
 * to be a hand-maintained copy that had already drifted from the app's
 * scoring; tuning changes belong in shared/.
 */
export {
  suggest,
  displayName as memberDisplayName,
  DAY_SHORT,
  type DayOfWeek,
  type TimeSlot,
  type Suggestion,
  type SuggestionCandidate as Candidate,
  type SuggestionFriend as Friend,
  type SuggestionOuting as Outing,
  type SuggestionInput,
  type SuggestionResult,
  type AvailableSlot,
} from '../../shared/suggestion.js'
