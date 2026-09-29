import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

// Snack Bar / Bev Cart — Lightspeed K-Series 위치 "Pelham Hills - Snack Bar/Bev Cart" 대응 화면
export default function SnackBarPage() {
  return (
    <AdminFeaturePage
      actionLabel="Add Menu Item"
      description="Snack bar and beverage cart: menu items, prices, and daily sales. Orders can be attached to a tee-time or simulator booking at checkout."
      metrics={[
        { label: "Menu Items", value: "0" },
        { label: "Open Orders", value: "0" },
        { label: "Today's Sales", value: "$0.00" },
        { label: "Bev Cart Sales", value: "$0.00" },
      ]}
      rows={[
        {
          name: "Hot Food",
          detail: "Hot dogs, burgers, breakfast sandwiches",
          status: "Active",
        },
        { name: "Snacks", detail: "Chips, bars, candy", status: "Active" },
        {
          name: "Non-Alcoholic",
          detail: "Water, soft drinks, sports drinks, coffee",
          status: "Active",
        },
        {
          name: "Beer & Cider",
          detail: "Cans and draught — AGCO licensed service",
          status: "Active",
        },
        {
          name: "Bev Cart Route",
          detail: "On-course cart stock and route schedule",
          status: "Active",
        },
      ]}
      title="Snack Bar / Bev Cart"
    />
  );
}
