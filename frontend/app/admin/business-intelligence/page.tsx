import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

export default function BusinessIntelligencePage() {
  return (
    <AdminFeaturePage
      actionLabel="Add Insight"
      description="Review occupancy, yield, customer behavior, promo lift, and operational trends for course decisions."
      metrics={[
        { label: "Yield / Round", value: "$61.82" },
        { label: "Peak Fill", value: "94%" },
        { label: "Promo Lift", value: "+17%" },
        { label: "Repeat Rate", value: "42%" },
      ]}
      rows={[
        { name: "Saturday 8 AM Demand", detail: "Premium pricing recommended for next four weeks", status: "Active" },
        { name: "Cart Attachment", detail: "Cart uptake drops after 2 PM on weekdays", status: "Active" },
        { name: "No-show Watchlist", detail: "Three customers exceed repeat no-show threshold", status: "Review" },
      ]}
      title="Business Intelligence"
    />
  );
}
