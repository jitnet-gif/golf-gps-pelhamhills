"use client";

/**
 * 프로 샵 리테일(POS). 계산 / 상품·재고 / 매출·마감 세 가지를 **한 페이지 안의
 * 상태**로 전환한다.
 *
 * 왜 라우트를 쪼개지 않는가: 정적 export 라 탭마다 페이지를 만들면 이동할 때마다
 * 컴포넌트가 새로 마운트되어 **담아 둔 장바구니가 날아간다.** 계산 중에 재고를
 * 확인하러 갔다 오는 것은 카운터에서 늘 있는 일이다.
 *
 * 같은 이유로 탭 전환도 `{tab === "register" ? <RegisterTab/> : null}` 로 하면 안 된다.
 * 조건부 렌더는 **언마운트**라서 라우트를 쪼갠 것과 똑같이 장바구니가 사라진다.
 * 그래서 셋 다 켜 두고 `hidden` 으로 **보이기만** 끈다.
 *
 * 데이터는 여기서 한 번만 읽어서 탭에 내려 준다. 탭마다 각자 읽으면 계산대에서
 * 팔린 재고가 상품 목록에는 반영되지 않은, 서로 다른 두 진실이 생긴다.
 *
 * 프로 샵(`/admin/retail`)과 스낵바(`/admin/snack-bar`)가 이 한 벌을 같이 쓴다. 스낵바는
 * `category` 로 `Food & Beverage` 만 보는 계산대다 — 계산대를 두 개 만들면 결제·영수증·
 * 스캐너 규칙이 따로 늙는다. 매출(Sales) 탭은 클럽 전체 장부를 보여 주고, 어디서 팔렸는지는 "By station" 칸이 나눈다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminShell from "@/components/admin/AdminShell";
import ProductsTab from "@/components/retail/ProductsTab";
import RegisterTab from "@/components/retail/RegisterTab";
import SalesTab from "@/components/retail/SalesTab";
import {
  demoBusinessDate,
  demoLowStock,
  demoProducts,
  demoReport,
  demoSales,
} from "@/components/retail/demoData";
import { Chip, ErrorNote, OfflineBanner } from "@/components/retail/ui";
import retailApi, { toRetailError } from "@/lib/retail/api";
import type { LowStockItem, Product, RetailCategory } from "@/lib/retail/types";

const TABS = [
  { id: "register", label: "Register" },
  { id: "products", label: "Products" },
  { id: "sales", label: "Sales" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Props = {
  title: string;
  /** 이 분류만 파는 계산대(스낵바). 없으면 프로 샵 전체. */
  category?: RetailCategory;
};

export default function RetailWorkspace({ title, category }: Props) {
  const [tab, setTab] = useState<TabId>("register");
  const [products, setProducts] = useState<Product[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 서버에 닿지 못했다 → 예시 데이터를 보여 주고 저장 계열을 전부 잠근다.
   * `unconfigured`(주소 없음)와 `network`(연결 실패)를 화면에서 구분하지는 않는다 —
   * 계산대 앞 직원에게 둘은 같은 상황이다.
   */
  const [offline, setOffline] = useState(false);
  const [detail, setDetail] = useState("");
  /** 진짜 목록을 들고 있는데 새로고침만 실패한 경우. 데모로 내려가지 않는다. */
  const [refreshError, setRefreshError] = useState("");

  // 한 번이라도 진짜 목록을 받아 봤는가. 아래 `load` 의 실패 처리에서만 쓰므로
  // 렌더를 다시 돌릴 이유가 없어 state 가 아니라 ref 다.
  const hasRealData = useRef(false);

  const load = useCallback(async (options?: { background?: boolean }) => {
    // 판매 직후의 재고 갱신처럼 배경에서 도는 재조회는 스켈레톤을 띄우지 않는다.
    // 띄우면 결제할 때마다 상품 격자가 통째로 깜빡여서, 다음 손님을 찍으려던
    // 직원이 사라진 카드를 다시 찾아야 한다.
    if (!options?.background) setLoading(true);
    try {
      const list = await retailApi.listProducts();
      hasRealData.current = true;
      setProducts(list);
      setOffline(false);
      setDetail("");
      setRefreshError("");
      // 저재고는 곁가지다. 이게 없다고 상품 목록까지 데모로 떨어뜨리지 않는다.
      try {
        setLowStock(await retailApi.listLowStock());
      } catch {
        setLowStock([]);
      }
    } catch (cause) {
      const error = toRetailError(cause);

      if (hasRealData.current) {
        // 이미 진짜 목록을 들고 있다. 새로고침 한 번 실패했다고 예시 데이터로
        // 갈아 끼우면, 방금 서버가 찍어 준 진짜 영수증 위에 "표시된 값은
        // 예시입니다" 배너가 뜬다 — 직원이 방금 받은 돈을 의심하게 된다.
        setRefreshError(error.message);
        return;
      }

      // 처음부터 아무것도 못 받았다 → 예시 데이터로 착지한다. 빈 화면을
      // 보여 주면 직원은 "앱이 고장났다" 고 판단하고 닫는다.
      setOffline(true);
      // HTTP 오류일 때만 서버가 쓴 문장을 덧붙인다. 연결 실패의 문구에는
      // 서버 주소가 섞여 나올 수 있어 그대로 보여 주지 않는다.
      setDetail(error.kind === "http" ? error.message : "");
      setProducts(demoProducts);
      setLowStock(demoLowStock);
    } finally {
      if (!options?.background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load({ background: true });
  }, [load]);

  // 매출 탭은 **처음 열었을 때** 마운트한다. 처음부터 켜 두면 계산대만 쓸
  // 사람에게도 매출·리포트 두 요청이 나간다. 한 번 열린 뒤에는 계속 켜 두어
  // 고른 날짜와 스크롤 위치가 유지된다.
  const [salesOpened, setSalesOpened] = useState(false);
  useEffect(() => {
    if (tab === "sales") setSalesOpened(true);
  }, [tab]);

  // 데모 = 서버 없이 예시를 보고 있는 상태. 저장 계열 버튼을 전부 잠근다.
  // 저장된 줄 알았는데 아무 데도 안 남는 것이 빈 화면보다 나쁘다.
  const demo = offline;

  const shownProducts = useMemo(
    () => (category ? products.filter((item) => item.category === category) : products),
    [category, products],
  );
  const shownLowStock = useMemo(
    () => (category ? lowStock.filter((item) => item.category === category) : lowStock),
    [category, lowStock],
  );

  return (
    <AdminShell
      actions={
        // AdminShell 은 `actions` 를 데스크톱 헤더와 모바일 줄에 **두 번** 그린다.
        // 그래서 여기에는 id/htmlFor 를 쓰지 않는다 — 중복 id 는 label 연결을 깬다.
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <Chip active={tab === item.id} key={item.id} onClick={() => setTab(item.id)}>
              {item.label}
            </Chip>
          ))}
        </div>
      }
      title={title}
    >
      {/* 문서형 화면이라 `fill` 을 쓰지 않는다. pb-safe 로 홈 인디케이터를 피한다. */}
      <div className="grid min-w-0 gap-3 p-3 pb-safe">
        {offline ? <OfflineBanner demo detail={detail} /> : null}
        {refreshError ? (
          <ErrorNote>목록을 새로 읽지 못했습니다 — 화면의 값이 최신이 아닐 수 있습니다. {refreshError}</ErrorNote>
        ) : null}

        {/* 세 탭 모두 마운트한 채로 두고 보이기만 끈다. 조건부 렌더로 바꾸면
            상품을 담아 둔 채 재고를 확인하러 갔다 온 순간 장바구니가 비어 있다. */}
        <div className={tab === "register" ? "min-w-0" : "hidden"}>
          <RegisterTab
            demo={demo}
            loading={loading}
            lockedCategory={category}
            onSold={refresh}
            products={shownProducts}
            scanEnabled={tab === "register"}
          />
        </div>

        <div className={tab === "products" ? "min-w-0" : "hidden"}>
          <ProductsTab
            defaultCategory={category}
            demo={demo}
            loading={loading}
            lowStock={shownLowStock}
            onChanged={refresh}
            products={shownProducts}
          />
        </div>

        {salesOpened ? (
          <div className={tab === "sales" ? "min-w-0" : "hidden"}>
            <SalesTab
              demo={demo}
              demoDate={demoBusinessDate}
              demoReport={demoReport}
              demoSales={demoSales}
              offline={offline}
            />
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
