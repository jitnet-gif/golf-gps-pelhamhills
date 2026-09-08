export { HoleMap } from './HoleMap';
export { DistanceIndicator } from './DistanceIndicator';
export { ScoreCard } from './ScoreCard';
export { CourseSelector } from './CourseSelector';
export { Leaderboard } from './Leaderboard';
export { OnlineStatus } from './OnlineStatus';
export { SyncStatus } from './SyncStatus';
export { CourseIntro } from './CourseIntro';
export { HoleGuide } from './HoleGuide';
export { OfflineCourse } from './OfflineCourse';
export { OfflineNarration } from './OfflineNarration';
export { PromoBanner } from './PromoBanner';
export { NotificationOptIn } from './NotificationOptIn';
export { TeeSelector, TeeSwatch } from './TeeSelector';
export { HoleCard } from './HoleCard';
export { GreenDistances } from './GreenDistances';
export { HoleNarration } from './HoleNarration';
// buildHoleScript moved to @/lib/narrationScript - the ElevenLabs generator
// imports it from Node, where a .tsx component cannot be loaded.
export { buildHoleScript, buildHoleScriptParts } from '@/lib/narrationScript';
// The pure module exports a RoundSummary *type* of the same name; the component
// is what a barrel consumer wants, so the type stays behind @/lib/roundSummary.
export { RoundSummary } from './RoundSummary';
export { PinSurveyor } from './PinSurveyor';
