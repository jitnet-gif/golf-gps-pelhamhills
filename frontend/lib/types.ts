/**
 * 베푸 타입 정의 (TypeScript 타입)
 * 파일: frontend/lib/types.ts
 * 작성일: 2026-03-14 23:55
 *
 * DB 스키마(schema.sql)와 1:1 대응하는 TypeScript 타입들입니다.
 * 학생 여러분: 타입을 먼저 정의하면 코딩하면서 자동완성이 돼서 편합니다! 😊
 */

// ============================================================
// 감정 상태 타입 (emotion_logs 테이블과 동일)
// ============================================================
export type EmotionState =
  | 'neutral'
  | 'happy'
  | 'stressed'
  | 'sad'
  | 'angry'
  | 'overwhelmed'
  | 'anxious'
  | 'excited'

// ============================================================
// 말투 스타일 타입
// ============================================================
export type SpeechStyle = 'informal' | 'formal' | 'polite'

// ============================================================
// 사용자 프로필 (profiles 테이블)
// ============================================================
export interface Profile {
  id: string
  nickname: string
  speech_style: SpeechStyle
  occupation: string | null
  interests: string[]
  avatar_url: string | null
  timezone: string
  proactive_enabled: boolean
  created_at: string
  updated_at: string
}

// ============================================================
// 대화 (conversations 테이블)
// ============================================================
export interface Conversation {
  id: string
  user_id: string
  title: string | null
  summary: string | null
  emotion_state: EmotionState
  last_message_at: string | null
  created_at: string
  updated_at: string
  // 조인 데이터 (목록 조회 시)
  message_count?: number
}

// ============================================================
// 메시지 (messages 테이블)
// ============================================================
export interface Message {
  id: string
  conversation_id: string
  user_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments: Attachment[]
  detected_emotion: EmotionState | null
  emotion_confidence: number
  model_name?: string       // 가동 중인 AI 모델명 (테스트용)
  created_at: string
}

// 파일/이미지 첨부 (JSONB)
export interface Attachment {
  type: 'image' | 'file'    // 첨부 타입
  url: string               // Cloudflare R2 URL
  name: string              // 파일 이름
  size: number              // 파일 크기 (bytes)
}

// ============================================================
// Life Graph 노드 (life_graph_nodes 테이블)
// ============================================================
export type NodeType = 'person' | 'goal' | 'concern' | 'routine' | 'event'

export interface LifeGraphNode {
  id: string
  user_id: string
  node_type: NodeType
  label: string
  // 타입별 속성 (유연한 구조)
  properties: PersonProperties | GoalProperties | ConcernProperties | Record<string, unknown>
  is_active: boolean
  last_mentioned_at: string | null
  created_at: string
  updated_at: string
}

// 사람(person) 노드 속성
export interface PersonProperties {
  relation: string        // 절친, 직장동료, 가족 등
  birthday?: string       // "MM-DD" 형식
  workplace?: string      // 직장
  notes?: string          // 메모
}

// 목표(goal) 노드 속성
export interface GoalProperties {
  progress?: number       // 현재 진행 수치
  target?: number         // 목표 수치
  unit?: string           // 단위 (회, 권, %)
  deadline?: string       // 목표일 (YYYY-MM-DD)
}

// 고민(concern) 노드 속성
export interface ConcernProperties {
  severity: 'low' | 'medium' | 'high'   // 심각도
  resolved: boolean                       // 해결 여부
  resolved_at?: string                    // 해결 시각
}

// ============================================================
// Life Graph 엣지 (life_graph_edges 테이블)
// ============================================================
export interface LifeGraphEdge {
  id: string
  user_id: string
  source_node_id: string
  target_node_id: string
  relation_type: string
  strength: 1 | 2 | 3 | 4 | 5
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// 프로액티브 메시지 (proactive_messages 테이블)
// ============================================================
export type ProactiveTrigger =
  | 'birthday'       // 생일 D-N
  | 'goal_miss'      // 목표 미달성
  | 'pattern_break'  // 평소 패턴 이탈
  | 'followup'       // 이전 고민 팔로업
  | 'weather'        // 날씨 관련
  | 'morning'        // 모닝 브리핑

export interface ProactiveMessage {
  id: string
  user_id: string
  trigger_type: ProactiveTrigger
  related_node_id: string | null
  content: string
  is_read: boolean
  is_responded: boolean
  scheduled_at: string
  sent_at: string | null
  created_at: string
}

// ============================================================
// 구독 플랜
// ============================================================
export type SubscriptionPlan = 'free' | 'bepu' | 'premium' | 'family'

export interface Subscription {
  id: string
  user_id: string
  plan: SubscriptionPlan
  status: 'active' | 'cancelled' | 'expired' | 'trial'
  current_period_start: string
  current_period_end: string | null
  created_at: string
}

// ============================================================
// SSE 스트리밍 응답 이벤트 타입
// (메시지 전송 API의 스트리밍 응답)
// ============================================================
export interface SSETokenEvent {
  event: 'token'
  data: {
    token: string       // 스트리밍되는 텍스트 조각
    message_id: string
    model_name?: string // 가동 중인 AI 모델명
  }
}

export interface SSEDoneEvent {
  event: 'done'
  data: {
    message_id: string
    detected_emotion: EmotionState
    model_name?: string
    life_graph_updated: boolean
    proactive_triggered: boolean
  }
}

export interface SSEErrorEvent {
  event: 'error'
  data: {
    code: string
    message: string
  }
}
