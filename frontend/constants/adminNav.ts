// 어드민 사이드바 메뉴 — 사업부(Division)별 링크 목록
// AdminSidebar 상단 드롭다운으로 사업부를 전환한다.

export type AdminLink = { label: string; href: string };

export type AdminDivision = {
  key: "golf" | "snack-retail" | "simulator";
  label: string;
  links: AdminLink[];
};

export const ADMIN_DIVISIONS: AdminDivision[] = [
  {
    key: "golf",
    label: "Golf",
    links: [
      { label: "Pelham Hills Golf Club", href: "/" },
      { label: "Tee Sheet", href: "/admin" },
      { label: "Tee Times & Pricing", href: "/pricing" },
      { label: "Dynamic Pricing", href: "/dynamic-pricing" },
      { label: "Events", href: "/events" },
      { label: "Customers", href: "/customers" },
      { label: "Tour Operators", href: "/tour-operators" },
      { label: "Promotions", href: "/promotions" },
      { label: "Calls & SMS", href: "/calls" },
      { label: "Reports", href: "/reports" },
      { label: "Business Intelligence", href: "/business-intelligence" },
      { label: "Radar", href: "/radar" },
      { label: "Integrations", href: "/integrations" },
      { label: "Settings", href: "/settings" },
    ],
  },
  {
    key: "snack-retail",
    label: "Snack Bar & Retail",
    links: [
      { label: "Snack Bar / Bev Cart", href: "/snack-bar" },
      { label: "Pro Shop Retail", href: "/retail" },
      { label: "Reports", href: "/reports" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
  {
    key: "simulator",
    label: "Indoor Golf Simulator",
    links: [
      { label: "Bay Sheet", href: "/simulator-sheet" },
      { label: "Online Booking", href: "/simulator" },
      { label: "Customers", href: "/customers" },
      { label: "Calls & SMS", href: "/calls" },
      { label: "Reports", href: "/reports" },
    ],
  },
];

// 현재 페이지(active 라벨)가 속한 사업부. 여러 곳에 있는 메뉴(Reports 등)는 Golf 우선.
export function divisionForLabel(label: string): AdminDivision {
  return ADMIN_DIVISIONS.find((d) => d.links.some((l) => l.label === label)) ?? ADMIN_DIVISIONS[0];
}
