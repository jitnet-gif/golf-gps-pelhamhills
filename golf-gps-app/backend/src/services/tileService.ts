/**
 * R2 타일 메타데이터 서비스
 * src/services/tileService.ts
 *
 * 골프 코스 지도 타일 관리 (현재는 대기 중)
 *
 * R2 설정이 완료되면:
 * 1. wrangler.toml의 [[r2_buckets]] 섹션 주석 해제
 * 2. R2 버킷 생성 후 ID 입력
 * 3. 이 서비스의 타일 업로드/조회 로직 활성화
 */

import type { Env } from '../types/env'
import { NotFoundError } from '../middleware/errorHandler'

export interface TileMetadata {
  bucket: string
  path: string
  url: string
  created_at: string
}

export class TileService {
  constructor(private env: Env) {}

  /**
   * 타일 URL 생성
   *
   * 형식: https://<r2-custom-domain>/tiles/<course_id>/<zoom>/<x>/<y>.png
   */
  getTileUrl(courseId: string, zoom: number, x: number, y: number): string {
    // R2 배포 도메인이나 커스텀 도메인 사용
    // 예: https://tiles.golf-gps.workers.dev/tiles/<course_id>/<zoom>/<x>/<y>.png
    return `${this.getTileBaseUrl()}/tiles/${courseId}/${zoom}/${x}/${y}.png`
  }

  /**
   * 타일 기본 URL
   * 프로덕션에서는 커스텀 도메인 사용 권장
   */
  private getTileBaseUrl(): string {
    const env = this.env.ENVIRONMENT
    if (env === 'production') {
      // 프로덕션: 커스텀 도메인 (wrangler.toml에 설정)
      return 'https://tiles.golf-gps.com'
    } else {
      // 개발/스테이징: Workers 기본 도메인
      return `https://golf-gps-backend-${env}.workers.dev`
    }
  }

  /**
   * 타일 메타데이터 저장 (데이터베이스에 기록)
   */
  async saveTileMetadata(
    courseId: string,
    zoom: number,
    x: number,
    y: number,
    bucket: string
  ): Promise<TileMetadata> {
    // 현재는 R2 설정 대기 중이므로 미구현
    // 실제 구현:
    // 1. Supabase의 tile_metadata 테이블에 저장
    // 2. 타일 접근 통계 수집
    throw new NotFoundError('Tile service is not yet available')
  }

  /**
   * R2 타일 업로드 (Workers 라우트에서 호출)
   *
   * 사용법:
   * ```
   * const buffer = await image.arrayBuffer()
   * await tileService.uploadTile(courseId, zoom, x, y, buffer)
   * ```
   */
  async uploadTile(
    courseId: string,
    zoom: number,
    x: number,
    y: number,
    data: ArrayBuffer
  ): Promise<TileMetadata> {
    if (!this.env.TILES) {
      throw new NotFoundError('R2 TILES bucket is not configured')
    }

    const path = `tiles/${courseId}/${zoom}/${x}/${y}.png`

    try {
      await this.env.TILES.put(path, data, {
        httpMetadata: {
          contentType: 'image/png',
        },
      })

      return {
        bucket: 'TILES',
        path,
        url: this.getTileUrl(courseId, zoom, x, y),
        created_at: new Date().toISOString(),
      }
    } catch (error) {
      throw new NotFoundError(`Failed to upload tile: ${(error as Error).message}`)
    }
  }

  /**
   * R2 타일 삭제
   */
  async deleteTile(courseId: string, zoom: number, x: number, y: number): Promise<void> {
    if (!this.env.TILES) {
      throw new NotFoundError('R2 TILES bucket is not configured')
    }

    const path = `tiles/${courseId}/${zoom}/${x}/${y}.png`

    try {
      await this.env.TILES.delete(path)
    } catch (error) {
      throw new NotFoundError(`Failed to delete tile: ${(error as Error).message}`)
    }
  }
}
