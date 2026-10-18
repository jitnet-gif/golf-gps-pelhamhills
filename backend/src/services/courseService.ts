/**
 * 코스 데이터 관리 서비스
 * src/services/courseService.ts
 *
 * 코스 및 홀 정보 조회 로직
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Course, Hole } from '@golf-gps/shared'
import { NotFoundError, ValidationError } from '../middleware/errorHandler'

export class CourseService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 페이지네이션과 검색이 포함된 코스 목록 조회
   */
  async listCourses(
    limit: number = 20,
    offset: number = 0,
    search?: string
  ): Promise<{ courses: Course[]; total: number }> {
    let query = this.supabase
      .from('courses')
      .select('*', { count: 'exact' })

    // 검색 필터
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,location.ilike.%${search}%`
      )
    }

    // 페이지네이션
    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw new ValidationError('Failed to fetch courses', { supabaseError: error })
    }

    return {
      courses: (data || []) as Course[],
      total: count || 0,
    }
  }

  /**
   * 코스 상세 정보 조회 (홀 정보 포함)
   */
  async getCourseDetail(courseId: string): Promise<Course & { holes: Hole[] }> {
    // 코스 조회
    const { data: course, error: courseError } = await this.supabase
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .single()

    if (courseError || !course) {
      throw new NotFoundError(`Course not found: ${courseId}`)
    }

    // 홀 정보 조회
    const { data: holes, error: holesError } = await this.supabase
      .from('holes')
      .select('*')
      .eq('course_id', courseId)
      .order('hole_number', { ascending: true })

    if (holesError) {
      throw new ValidationError('Failed to fetch holes', { supabaseError: holesError })
    }

    return {
      ...(course as Course),
      holes: (holes || []) as Hole[],
    }
  }

  /**
   * 특정 코스의 홀 조회
   */
  async getHolesByCourse(courseId: string): Promise<Hole[]> {
    const { data, error } = await this.supabase
      .from('holes')
      .select('*')
      .eq('course_id', courseId)
      .order('hole_number', { ascending: true })

    if (error) {
      throw new ValidationError('Failed to fetch holes', { supabaseError: error })
    }

    return (data || []) as Hole[]
  }

  /**
   * 홀 정보 조회
   */
  async getHole(holeId: string): Promise<Hole> {
    const { data, error } = await this.supabase
      .from('holes')
      .select('*')
      .eq('id', holeId)
      .single()

    if (error || !data) {
      throw new NotFoundError(`Hole not found: ${holeId}`)
    }

    return data as Hole
  }
}
