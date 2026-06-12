/**
 * Shim — the engine lives in shared/suggestion.ts, the single source of
 * truth also consumed by api/_lib/suggestion.ts (missionary-sheet pull).
 * Tuning changes belong there so the app and the sheet always rank the
 * same way.
 */
export {
  suggest,
  displayName,
  DAY_SHORT,
  type DayOfWeek,
  type TimeSlot,
  type Suggestion,
  type SuggestionCandidate,
  type SuggestionFriend,
  type SuggestionOuting,
  type SuggestionInput,
  type SuggestionResult,
  type AvailableSlot,
} from '../../shared/suggestion'
