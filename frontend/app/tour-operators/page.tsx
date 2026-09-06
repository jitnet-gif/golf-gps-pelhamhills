import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

export default function TourOperatorsPage() {
  return (
    <AdminFeaturePage
      active="Tour Operators"
      actionLabel="Add Operator"
      description="Manage outside tour partners, contracted inventory, commission terms, and voucher reconciliation."
      metrics={[
        { label: "Operators", value: "5" },
        { label: "Held Rounds", value: "64" },
        { label: "Commission", value: "12%" },
        { label: "Open Vouchers", value: "9" },
      ]}
      rows={[
        { name: "Niagara Golf Travel", detail: "Weekend package inventory with 12% commission", status: "Active" },
        { name: "Ontario Stay & Play", detail: "Midweek public tee-time allocation", status: "Active" },
        { name: "Hotel Partner Desk", detail: "Voucher verification required at check-in", status: "Paused" },
      ]}
      title="Tour Operators"
    />
  );
}
