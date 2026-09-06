import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

export default function RadarPage() {
  return (
    <AdminFeaturePage
      active="Radar"
      actionLabel="Add Alert"
      description="Monitor weather, demand, cancellations, pace-of-play risk, and urgent tee sheet changes."
      metrics={[
        { label: "Weather Alerts", value: "2" },
        { label: "Open Prime Slots", value: "5" },
        { label: "Pace Risks", value: "3" },
        { label: "Refund Tasks", value: "4" },
      ]}
      rows={[
        { name: "Rain Window", detail: "Possible weather delay between 2 PM and 4 PM", status: "Active" },
        { name: "Prime Slot Open", detail: "Saturday 8:18 AM cancellation needs waitlist outreach", status: "Active" },
        { name: "Slow Group Watch", detail: "Back-nine pace risk from tournament block", status: "Review" },
      ]}
      title="Radar"
    />
  );
}
