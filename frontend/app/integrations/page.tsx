import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

export default function IntegrationsPage() {
  return (
    <AdminFeaturePage
      active="Integrations"
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
        { name: "ElevenLabs Voice Agent", detail: "에이전트 ID · 보이스 · 영업시간 외 자동 응답 (키는 서버 env에만 보관)", status: "Draft" },
        { name: "Twilio Voice + SMS", detail: "대표 번호 · Messaging Service · 확정/리마인더 템플릿", status: "Draft" },
      ]}
      title="Integrations"
    />
  );
}
