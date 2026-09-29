import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

export default function CallsPage() {
  return (
    <AdminFeaturePage
      actionLabel="Export Log"
      description="AI 전화 예약 통화 목록(결과별), 녹취·요약, 문자 수발신함, 수신 거부(STOP) 목록을 한 화면에서 관리합니다. 현재는 샘플 데이터입니다 — 문자 기록은 /api/v1/sms/messages 에서 읽어 오게 바꿀 예정입니다."
      metrics={[
        { label: "오늘 AI 통화", value: "12" },
        { label: "예약 성사", value: "7" },
        { label: "직원 연결", value: "2" },
        { label: "SMS 발송", value: "18" },
      ]}
      rows={[
        {
          name: "PH-10392 · Kim, Daniel",
          detail:
            "07:42 · 1분 34초 · 4인 18홀 7:52 AM · 확정/결제 링크 SMS delivered",
          status: "Active",
        },
        {
          name: "PH-10391 · +1 905-***-2210",
          detail: "07:31 · 2분 05초 · 단체(12인) 문의 → 프로샵 연결",
          status: "Active",
        },
        {
          name: "PH-10390 · Walton, Connor",
          detail: "07:18 · 0분 58초 · 예약 변경 11:01 → 11:10",
          status: "Active",
        },
        {
          name: "PH-10389 · +1 289-***-4471",
          detail: "07:05 · 1분 12초 · 만석 → 대기 등록 (Tee Sniper)",
          status: "Active",
        },
        {
          name: "SMS STOP · +1 905-***-0934",
          detail: "수신 거부 요청 — 이후 리마인더 발송 제외",
          status: "Paused",
        },
      ]}
      title="Calls & SMS"
    />
  );
}
