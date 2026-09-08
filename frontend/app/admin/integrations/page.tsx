import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

export default function IntegrationsPage() {
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
    />
  );
}
