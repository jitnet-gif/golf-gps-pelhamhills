"use client";

/**
 * 클럽 전체 매출 — 프로 샵·스낵바·티 시트(그린피)·실내 베이가 한 화면에.
 *
 * 세 사업부 메뉴의 "Reports" 가 모두 여기로 온다. 예전 이 화면은 숫자가 전부 박혀 있는
 * 샘플(매출 $8,421, 가운데 표의 손님까지)이라, 실제로 무엇이 팔렸든 늘 같은 값을 보여 줬다.
 *
 * 매출은 계산서 한 장부(`pelham_bills`, 0005)에 모두 모이고 `station` 으로만 나뉜다. 그래서
 * 새 리포트를 만들지 않고 리테일의 매출 탭(`SalesTab`)을 그대로 띄운다 — 같은 숫자를 두 벌로
 * 그리면 언젠가 어긋난다. 여기는 데모로 내려가지 않는다: 서버가 안 되면 오류를 보여 준다.
 * 가짜 숫자 옆의 진짜 숫자가 이 화면이 고치려던 바로 그 문제다.
 */

import AdminShell from "@/components/admin/AdminShell";
import SalesTab from "@/components/retail/SalesTab";

export default function ReportsPage() {
  return (
    <AdminShell title="Reports">
      <div className="min-w-0 p-4">
        <SalesTab demo={false} offline={false} />
      </div>
    </AdminShell>
  );
}
