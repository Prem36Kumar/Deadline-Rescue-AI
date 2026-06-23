import { z } from 'zod'

export const UrgencyLevelSchema = z.enum(['Critical', 'High', 'Medium', 'Low'])
export type UrgencyLevel = z.infer<typeof UrgencyLevelSchema>

export const ActionPlanSchema = z.object({
  now:       z.string(), // Do in the next 30-60 minutes
  soon:      z.string(), // Do if you still have hours/days
  emergency: z.string(), // Last-resort if almost out of time
})
export type ActionPlan = z.infer<typeof ActionPlanSchema>

export const AutoDraftTypeSchema = z.enum([
  'extension_request',
  'confirmation',
  'payment_reminder',
  'apology',
  'none',
])
export type AutoDraftType = z.infer<typeof AutoDraftTypeSchema>

export const CategorySchema = z.enum([
  'Assignment',
  'Bill Payment',
  'Interview',
  'Meeting',
  'Exam',
  'Job Application',
  'Subscription',
  'Other',
])
export type Category = z.infer<typeof CategorySchema>

export const DeadlineResultSchema = z.object({
  task_name:       z.string(),
  deadline_text:   z.string(),                                       // Human readable: "Friday 27 June, 11:59 PM"
  deadline_iso:    z.string().nullable().optional().default(null),   // ISO 8601 if determinable
  time_remaining:  z.string(),                                       // "2 days 14 hours" | "OVERDUE"
  urgency_score:   z.number().int().min(0).max(100),
  urgency_level:   UrgencyLevelSchema,
  category:        CategorySchema,
  consequence:     z.string(),
  action_plan:     ActionPlanSchema,
  auto_draft:      z.string().optional().default(''),
  auto_draft_type: AutoDraftTypeSchema.optional().default('none'),
  language:        z.enum(['en', 'hi', 'hinglish']),
  confidence:      z.number().int().min(0).max(100),
})

export type DeadlineResult = z.infer<typeof DeadlineResultSchema>
