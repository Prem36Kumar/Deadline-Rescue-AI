import type { DeadlineResult } from './schema'
export interface SavedDeadline extends DeadlineResult {
  id: string
  saved_at: string
}
