/**
 * 공유 타입 정의 (Golf GPS App)
 * frontend와 backend 모두에서 사용하는 타입
 */

// ============================================================
// 데이터베이스 타입
// ============================================================

export interface Course {
  id: string
  name: string
  location: string
  par: number
  holes: number // hole_count
  created_at: string
  updated_at: string
}

export interface CourseDetail extends Course {
  holes: Hole[] // array of hole objects
}

export interface Hole {
  id: string
  course_id: string
  hole_number: number
  par: number
  handicap: number
  length: number // meters
  pin_gps_lat: number
  pin_gps_lng: number
  created_at: string
}

export interface Round {
  id: string
  course_id: string
  player_ids: string[] // JSON array of player user IDs
  start_time: string
  end_time: string | null
  status: 'in_progress' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}

export interface Score {
  id: string
  round_id: string
  hole_id: string
  player_id: string // user ID
  strokes: number
  is_synced: boolean
  created_at: string
  updated_at: string
}

// ============================================================
// API 요청/응답 타입
// ============================================================

export interface GetCoursesRequest {
  limit?: number
  offset?: number
  search?: string
}

export interface GetCoursesResponse {
  data: Course[]
  total: number
  limit: number
  offset: number
}

export type GetCourseDetailResponse = CourseDetail

export interface StartRoundRequest {
  course_id: string
  player_ids: string[]
}

export interface StartRoundResponse {
  round_id: string
  course_id: string
  start_time: string
}

export interface SubmitScoresRequest {
  round_id: string
  scores: {
    hole_id: string
    player_id: string
    strokes: number
  }[]
}

export interface SubmitScoresResponse {
  synced_count: number
  failed_count: number
  errors?: Array<{
    hole_id: string
    player_id: string
    error: string
  }>
}

export interface LeaderboardEntry {
  player_id: string
  player_name: string
  total_strokes: number
  total_score: number // vs par
  hole_scores: {
    hole_number: number
    strokes: number
    par: number
  }[]
}

export interface GetLeaderboardResponse {
  round_id: string
  course_id: string
  course_name: string
  leaderboard: LeaderboardEntry[]
}

// ============================================================
// 에러 응답 타입
// ============================================================

export interface ApiError {
  error: string
  code: string
  message: string
  status: number
  details?: Record<string, unknown>
}
