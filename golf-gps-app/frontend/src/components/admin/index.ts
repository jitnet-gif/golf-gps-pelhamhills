/**
 * 운영 화면 전용 배럴
 *
 * 최상위 components/index.ts에는 올리지 않습니다. 이 컴포넌트들은 /admin
 * 한 곳에서만 쓰는데, 공용 배럴에 섞이면 플레이어가 여는 화면의 번들에도
 * 딸려 들어갑니다.
 */

export { PromotionList, PromotionStatusBadge, getPromotionStatus } from './PromotionList';
export { PromotionForm } from './PromotionForm';
export { CampaignPanel } from './CampaignPanel';
export { StatsTable } from './StatsTable';
