"use client";

// Integrations — 백엔드 연동 목록 + **Operations 패널**.
//
// Operations 는 원래 티 시트 화면 아래에 붙어 있었지만, 맞추기로 한 pelhamhills
// 티 시트에는 그런 줄이 없어서 그 화면에서 뺐다. 기능 자체는 살아 있는 것이라
// 갈 곳이 필요했고, "백엔드 작업을 돌리고 상태를 본다" 는 성격상 여기가 맞다.
// 그냥 렌더를 지우면 컴포넌트 1000줄이 아무 데서도 열리지 않는 죽은 코드가 된다.

import AdminFeaturePage from "@/components/admin/AdminFeaturePage";
import OrchestrationPanel from "@/components/teesheet/OrchestrationPanel";
import { useTeeSheet } from "@/hooks/useTeeSheet";

export default function IntegrationsPage() {
  // OrchestrationPanel 은 컨트롤러 전체를 받는다 (작업 결과가 예약을 바꾸면 시트를
  // 다시 읽어야 하기 때문). 티 시트 화면과 같은 훅을 쓰므로 데이터 계약은 하나다.
  const controller = useTeeSheet();

  return (
    <AdminFeaturePage
      actionLabel="Add Integration"
      description="Connect booking, payment, SMS, email, accounting, and reporting systems used by the pro shop."
      metrics={[
        { label: "Connected", value: "4" },
        { label: "Warnings", value: "1" },
        { label: "Sync Jobs", value: "12" },
        { label: "API Health", value: "98%" },
      ]}
      rows={[
        { name: "Tee-Sniper API", detail: "Wanted tee-time automation and worker endpoint", status: "Active" },
        { name: "Payment Gateway", detail: "Collect, refund, and balance-due status sync", status: "Draft" },
        { name: "SMS Notifications", detail: "Same-day booking and cancellation alerts", status: "Active" },
      ]}
      title="Integrations"
    >
      <OrchestrationPanel controller={controller} />
    </AdminFeaturePage>
  );
}
