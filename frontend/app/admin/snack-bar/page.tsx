import RetailWorkspace from "@/components/retail/RetailWorkspace";

// Snack Bar / Bev Cart — Lightspeed K-Series 위치 "Pelham Hills - Snack Bar/Bev Cart" 대응 화면.
// 프로 샵 계산대와 같은 한 벌(`RetailWorkspace`)을 `Food & Beverage` 로 좁혀 쓴다.
export default function SnackBarPage() {
  return <RetailWorkspace category="Food & Beverage" title="Snack Bar / Bev Cart" />;
}
