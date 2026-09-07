/**
 * 코스 API 라우트
 * src/routes/courses.ts
 *
 * POST /api/courses - 코스 목록 조회 (배치/필터 지원)
 * GET /api/courses/:id - 코스 상세 + 홀 정보
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseClient } from '../lib/supabase'
import { CourseService } from '../services/courseService'
import { GetCoursesRequestSchema, CourseWithHolesSchema } from '../schemas/courses'
import { ValidationError } from '../middleware/errorHandler'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/**
 * POST /api/courses - 코스 목록 조회
 *
 * 요청 본문:
 * ```json
 * {
 *   "limit": 20,
 *   "offset": 0,
 *   "search": "Pelham"
 * }
 * ```
 *
 * 응답:
 * ```json
 * {
 *   "data": [...],
 *   "total": 42,
 *   "limit": 20,
 *   "offset": 0
 * }
 * ```
 */
router.post('/api/courses', async (c) => {
  try {
    const body = await c.req.json()

    // 요청 검증
    const request = GetCoursesRequestSchema.parse(body)

    // Supabase 클라이언트 생성
    const supabase = createSupabaseClient(c.env)
    const courseService = new CourseService(supabase)

    // 코스 조회
    const { courses, total } = await courseService.listCourses(
      request.limit,
      request.offset,
      request.search
    )

    return c.json({
      data: courses,
      total,
      limit: request.limit,
      offset: request.offset,
    })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to fetch courses'
    )
  }
})

/**
 * GET /api/courses/:id - 코스 상세 정보 (홀 포함)
 *
 * 응답:
 * ```json
 * {
 *   "id": "uuid",
 *   "name": "Pelham Hills Golf Club",
 *   "location": "Seoul, Korea",
 *   "par": 72,
 *   "holes": 18,
 *   "holes": [
 *     {
 *       "id": "uuid",
 *       "hole_number": 1,
 *       "par": 4,
 *       "length": 385,
 *       "pin_gps_lat": 37.123,
 *       "pin_gps_lng": 127.456
 *     },
 *     ...
 *   ]
 * }
 * ```
 */
router.get('/api/courses/:id', async (c) => {
  try {
    const courseId = c.req.param('id')

    // Supabase 클라이언트 생성
    const supabase = createSupabaseClient(c.env)
    const courseService = new CourseService(supabase)

    // 코스 상세 정보 조회
    const course = await courseService.getCourseDetail(courseId)

    // 응답 검증
    const response = CourseWithHolesSchema.parse(course)

    return c.json(response)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to fetch course'
    )
  }
})

export default router
