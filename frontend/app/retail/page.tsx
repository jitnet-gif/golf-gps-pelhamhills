import AdminFeaturePage from "@/components/admin/AdminFeaturePage";

// Pro Shop Retail — 골프 용품 판매/재고
export default function RetailPage() {
  return (
    <AdminFeaturePage
      active="Pro Shop Retail"
      actionLabel="Add Product"
      description="Pro shop merchandise: products, stock levels, low-stock alerts, and member/public pricing. Sales can be attached to a tee-time or simulator booking at checkout."
      metrics={[
        { label: "Products", value: "0" },
        { label: "Low Stock", value: "0" },
        { label: "Today's Sales", value: "$0.00" },
        { label: "Inventory Value", value: "$0.00" },
      ]}
      rows={[
        { name: "Golf Balls", detail: "Sleeves and dozens by brand", status: "Active" },
        { name: "Gloves", detail: "Men's, women's, junior — size run", status: "Active" },
        { name: "Apparel", detail: "Logo shirts, hats, outerwear", status: "Active" },
        { name: "Accessories", detail: "Tees, markers, towels, divot tools", status: "Active" },
        { name: "Rentals", detail: "Club sets and push carts", status: "Active" },
      ]}
      title="Pro Shop Retail"
    />
  );
}
