/**
 * 관리자 배너 API 스키마 검증
 * src/schemas/admin.ts
 */

import { z } from 'zod'
import { PromotionPlacementSchema, PromotionSchema } from './promotions'

// ============================================================
// 공통 필드
// ============================================================

/**
 * 노출 기간에 쓰는 시각.
 *
 * 시간대를 반드시 붙이게 합니다. "2026-09-30T15:00:00"처럼 offset 없는
 * 문자열을 그대로 넘기면 Postgres가 서버 시간대로 해석해서, 한국 시각으로
 * 적어 넣은 종료 시각이 아홉 시간 어긋난 채 저장됩니다.
 */
const IsoDateTimeSchema = z.string().datetime({ offset: true })

/**
 * 컬럼 하나하나의 규칙. 등록(전부 필요)과 수정(보낸 것만)이 같은 규칙을
 * 쓰도록 한 군데에 모아 둡니다. 길이 제한은 migrations/0003의 VARCHAR
 * 길이와 같습니다 - 여기서 걸러야 400이 되고, 안 걸러면 500이 됩니다.
 */
const fields = {
  title: z.string().min(1).max(120),
  body: z.string().max(300).nullable(),
  // 푸시 알림에 그대로 실려 가므로 절대 경로여야 합니다. 상대 경로 이미지는
  // 브라우저가 아니라 푸시 서비스가 받아 가기 때문에 뜨지 않습니다.
  image_url: z.string().url().max(1000).nullable(),
  // 이쪽은 앱 안에서 여는 주소라 '/courses/xxx' 같은 상대 경로도 허용합니다.
  link_url: z.string().min(1).max(500).nullable(),
  placement: PromotionPlacementSchema,
  priority: z.number().int().min(-1000).max(1000),
  starts_at: IsoDateTimeSchema.nullable(),
  ends_at: IsoDateTimeSchema.nullable(),
  active: z.boolean(),
}

/**
 * 노출 기간이 뒤집혔는지.
 *
 * DB에도 같은 CHECK(promotions_window_valid)이 있지만, 거기까지 가면
 * 관리자에게는 정체 모를 제약 조건 이름만 돌아옵니다. 한쪽이 비어 있으면
 * (즉시 시작 / 무기한) 따질 것이 없으므로 통과시킵니다.
 */
function isWindowValid(v: { starts_at?: string | null; ends_at?: string | null }): boolean {
  if (!v.starts_at || !v.ends_at) return true
  return new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime()
}

const WINDOW_MESSAGE = { message: 'ends_at은 starts_at보다 뒤여야 합니다' }

// ============================================================
// 요청 스키마
// ============================================================

/**
 * GET /api/admin/promotions 쿼리
 *
 * 관리 화면은 내려간 배너도 봐야 하므로 필터가 없습니다. 거르는 것은
 * 화면 쪽 일이고, 서버는 있는 그대로 최신순으로 넘깁니다.
 */
export const AdminListPromotionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type AdminListPromotionsQuery = z.infer<typeof AdminListPromotionsQuerySchema>

/**
 * POST /api/admin/promotions 본문
 *
 * title 말고는 모두 선택입니다. placement/priority/active의 기본값은
 * DB 기본값과 같은 값을 여기서도 명시합니다 - 등록 직후 화면에 뿌릴 값을
 * 요청 쪽에서 미리 알 수 있어야 하기 때문입니다.
 */
export const CreatePromotionSchema = z
  .object({
    title: fields.title,
    body: fields.body.optional(),
    image_url: fields.image_url.optional(),
    link_url: fields.link_url.optional(),
    placement: fields.placement.default('home'),
    priority: fields.priority.default(0),
    starts_at: fields.starts_at.optional(),
    ends_at: fields.ends_at.optional(),
    active: fields.active.default(true),
  })
  .refine(isWindowValid, WINDOW_MESSAGE)

export type CreatePromotionInput = z.infer<typeof CreatePromotionSchema>

/**
 * PATCH /api/admin/promotions/:id 본문
 *
 * 모든 필드가 optional이고, 날짜와 본문·이미지·링크는 nullable이기도 합니다.
 * 이 둘은 뜻이 다릅니다.
 * - 필드를 아예 안 보냄  -> 지금 값을 그대로 둡니다 (파싱 결과에 키가 없음)
 * - null을 보냄          -> 값을 지웁니다 (파싱 결과에 키가 null로 남음)
 * JSON에는 undefined가 없으므로, 파싱 결과에서 값이 undefined인 키는 항상
 * 전자입니다. 실제로 걸러내는 곳은 promotionAdminService.toColumnPatch입니다.
 *
 * title만 nullable이 아닙니다. NOT NULL 컬럼이라 지울 수 없습니다.
 */
export const UpdatePromotionSchema = z
  .object({
    title: fields.title.optional(),
    body: fields.body.optional(),
    image_url: fields.image_url.optional(),
    link_url: fields.link_url.optional(),
    placement: fields.placement.optional(),
    priority: fields.priority.optional(),
    starts_at: fields.starts_at.optional(),
    ends_at: fields.ends_at.optional(),
    active: fields.active.optional(),
  })
  // 빈 본문은 거부합니다. 통과시키면 아무것도 바꾸지 않는 UPDATE가 나가고,
  // updated_at 트리거만 돌아서 "누가 언제 고쳤나"가 거짓말이 됩니다.
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: '수정할 필드를 하나 이상 보내야 합니다',
  })
  // 한쪽만 보낸 수정은 여기서 못 잡습니다(저장된 값과 비교해야 하므로).
  // 그 경우는 DB의 CHECK 제약이 마지막 방어선입니다.
  .refine(isWindowValid, WINDOW_MESSAGE)

export type UpdatePromotionInput = z.infer<typeof UpdatePromotionSchema>

/** 경로의 :id. uuid가 아니면 Postgres까지 보내지 않고 400으로 끊습니다. */
export const PromotionIdSchema = z.string().uuid()

// ============================================================
// 응답 스키마
// ============================================================

/**
 * 관리 화면이 보는 배너.
 *
 * 공개 API(PromotionSchema)에 없는 active와 시각 정보가 붙습니다. 내려간
 * 배너를 화면에서 구분하려면 active가 필요하고, 목록 정렬 기준이 created_at
 * 이라 그 값도 같이 보여 줘야 순서가 납득이 갑니다.
 */
export const AdminPromotionSchema = PromotionSchema.extend({
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type AdminPromotion = z.infer<typeof AdminPromotionSchema>

export const AdminPromotionListSchema = z.object({
  data: z.array(AdminPromotionSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
})

export type AdminPromotionList = z.infer<typeof AdminPromotionListSchema>
