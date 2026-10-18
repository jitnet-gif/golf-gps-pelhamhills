/**
 * 코스 관련 API 스키마 검증
 * src/schemas/courses.ts
 */

import { z } from 'zod'

// ============================================================
// 요청 스키마
// ============================================================

export const GetCoursesRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  search: z.string().max(100).optional(),
})

export type GetCoursesRequest = z.infer<typeof GetCoursesRequestSchema>

// ============================================================
// 응답 스키마
// ============================================================

export const HoleSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  hole_number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(5),
  handicap: z.number().int().min(1).max(18),
  length: z.number().int().min(50).max(700),
  pin_gps_lat: z.number(),
  pin_gps_lng: z.number(),
  created_at: z.string().datetime(),
})

export type Hole = z.infer<typeof HoleSchema>

export const CourseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  par: z.number().int().min(36).max(144),
  holes: z.number().int().min(9).max(18),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
})

export type Course = z.infer<typeof CourseSchema>

export const CourseWithHolesSchema = CourseSchema.omit({ holes: true }).extend({
  holes: z.array(HoleSchema),
})

export type CourseWithHoles = z.infer<typeof CourseWithHolesSchema>

export const GetCoursesResponseSchema = z.object({
  data: z.array(CourseSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
})

export type GetCoursesResponse = z.infer<typeof GetCoursesResponseSchema>
