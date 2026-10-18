/**
 * 프로모션(마케팅 배너) API 스키마 검증
 * src/schemas/promotions.ts
 */

import { z } from 'zod'

// ============================================================
// 요청 스키마
// ============================================================

export const PromotionPlacementSchema = z.enum(['home', 'scorecard'])

export type PromotionPlacement = z.infer<typeof PromotionPlacementSchema>

export const GetPromotionsQuerySchema = z.object({
  placement: PromotionPlacementSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
})

export type GetPromotionsQuery = z.infer<typeof GetPromotionsQuerySchema>

// ============================================================
// 응답 스키마
// ============================================================

export const PromotionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  body: z.string().max(300).nullable(),
  image_url: z.string().nullable(),
  link_url: z.string().nullable(),
  placement: PromotionPlacementSchema,
  priority: z.number().int(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
})

export type Promotion = z.infer<typeof PromotionSchema>

export const GetPromotionsResponseSchema = z.object({
  data: z.array(PromotionSchema),
})

export type GetPromotionsResponse = z.infer<typeof GetPromotionsResponseSchema>
