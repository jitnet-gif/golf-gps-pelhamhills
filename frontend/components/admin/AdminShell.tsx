"use client";

/**
 * 어드민 콘솔의 껍데기 — 데스크톱 사이드바 + 모바일 서랍/하단 탭.
 *
 * 예전에는 이 사이드바 마크업이 `AdminFeaturePage.tsx` 와 `app/teesheet/page.tsx`
 * 에 각각 복사되어 있었고, 둘 다 `hidden lg:block` 이었다. 즉 **폭 1024px 미만에서는
 * 어드민에 메뉴가 아예 없었다.** 티 시트를 열면 다른 화면으로 갈 방법이 없었고
 * 뒤로 가기가 유일한 탈출구였다. 휴대폰으로 프로 샵을 보는 사람에게는 메뉴 없는
 * 앱이었던 셈이다. 이 컴포넌트가 그 구멍을 메운다.
 *
 * ## 두 가지 높이 모드
 *
 * 어드민에는 성격이 다른 두 종류의 화면이 있다.
 *
 * - `fill`  — 티 시트처럼 **페이지가 스크롤되지 않고** 내부 격자만 스크롤하는 화면.
 * - 기본값 — 지표 카드와 표가 아래로 이어지는 보통의 문서형 화면.
 *
 * 하나로 합치려 하면 둘 중 하나가 깨진다. `fill` 에 문서형을 넣으면 내용이 잘리고,
 * 문서형에 `fill` 을 넣으면 티 시트가 내용 높이만큼 부풀어 페이지가 두 번 스크롤된다.
 * 그래서 호출부가 명시적으로 고른다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ADMIN_HOME, CLUB, SITE_HOME, adminNav, adminQuickNav, isActive } from "@/lib/nav";

type Props = {
  /** 헤더에 굵게 찍히는 현재 화면 이름. */
  title: string;
  /** 제목 옆(모바일에서는 아래)에 놓을 버튼 등. */
  actions?: ReactNode;
  /**
   * true 면 본문이 남는 높이를 정확히 채우고 페이지 자체는 스크롤하지 않는다.
   * 티 시트처럼 내부에서만 스크롤하는 화면 전용. 위의 "두 가지 높이 모드" 참고.
   */
  fill?: boolean;
  children: ReactNode;
};

export default function AdminShell({ title, actions, fill = false, children }: Props) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 화면을 옮기면 서랍은 닫힌다. 닫지 않으면 새 화면 위에 이전 메뉴가 그대로
  // 덮여 있어서, 사용자가 방금 고른 화면을 볼 수 없다.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // 서랍이 열려 있는 동안 뒤쪽 본문이 스크롤되면(iOS 의 scroll chaining) 서랍을
  // 닫았을 때 엉뚱한 위치에 가 있게 된다. 열려 있는 동안만 body 를 묶는다.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Esc 로 닫기. 서랍은 모달이므로 키보드만 쓰는 사용자에게도 탈출구가 있어야 한다.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    // `fill` 일 때만 h-screen/overflow-hidden 을 건다. 문서형 화면에 걸면 표가 잘린다.
    <div
      className={`bg-[#f2f2f4] text-[#1f2328] ${
        fill ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]"
      }`}
    >
      {/* 100dvh 를 쓰는 이유: 모바일 사파리·크롬의 주소창이 접히고 펴질 때 100vh 는
          실제로 보이는 높이보다 커서, 화면 아래쪽(하단 탭)이 주소창에 가려진다. */}

      {/* 트랙을 minmax(0,1fr) 로 못박는다. auto 트랙은 max-content 로 부풀어서
          안쪽 overflow-x-auto 컨테이너의 내용 폭이 좁은 화면에서 페이지 전체를
          가로로 밀어낸다 — 티 시트 격자에서 실제로 겪은 문제다. */}
      <div
        className={`grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[188px_minmax(0,1fr)] ${
          fill ? "h-full" : "min-h-[100dvh]"
        }`}
      >
        <DesktopSidebar pathname={pathname} />

        <section
          className={`grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] ${
            fill ? "grid-rows-[auto_minmax(0,1fr)_auto]" : "grid-rows-[auto_1fr_auto]"
          }`}
        >
          {/* 머리 부분 3종은 **반드시 하나의 grid 아이템으로 묶는다.**
              풀어 놓으면 아이템 개수가 화면 폭에 따라 달라진다: 데스크톱 헤더는
              모바일에서 `display:none` 이라 아이템에서 빠지고, 그 빈자리로 모바일
              액션 바가 2번째 행 — 즉 `1fr` 트랙 — 으로 밀려 들어가 세로로 부풀고
              본문을 아래로 밀어낸다. 실측(390px, /admin/radar):
              `65px 221px 508px 50px` ← 내용 61px 짜리 액션 바가 221px 을 차지했다.
              데스크톱은 액션 바가 `lg:hidden` 이라 우연히 멀쩡했을 뿐이다.
              묶어 두면 폭과 무관하게 언제나 3개 아이템(머리/본문/탭)이 된다. */}
          <div className="min-w-0">
            <MobileTopBar onOpen={() => setDrawerOpen(true)} title={title} />
            <DesktopHeader actions={actions} title={title} />

            {/* 모바일에서는 헤더의 액션이 좁아 잘리므로 제목 줄 아래로 내려 준다. */}
            {actions ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-[#d4d4d8] bg-white px-4 py-2 lg:hidden">
                {actions}
              </div>
            ) : null}
          </div>

          <div className={fill ? "min-h-0 min-w-0 overflow-hidden" : "min-w-0"}>{children}</div>

          <MobileTabBar pathname={pathname} />
        </section>
      </div>

      <MobileDrawer onClose={() => setDrawerOpen(false)} open={drawerOpen} pathname={pathname} />
    </div>
  );
}

// ===== 데스크톱 사이드바 ================================================

function DesktopSidebar({ pathname }: { pathname: string | null }) {
  return (
    // Chronogolf 사이드바 순서: 워드마크 / 제품군 / 클럽 / 로그인 사용자 / 메뉴.
    // 클럽·사용자 줄은 메뉴가 아니라 "지금 어느 클럽에 누구로 들어와 있는가" 를
    // 말해 주는 문맥이라 nav 밖에 둔다 — 스크린리더에서 메뉴 항목으로 읽히면 안 된다.
    <aside className="hidden overflow-y-auto bg-[#111315] text-white lg:block">
      <div className="border-b border-white/10 px-4 py-4 text-sm font-bold">lightspeed</div>

      {/* 제품군 표시. Chronogolf 는 여기에 드롭다운을 두지만 우리는 골프 하나뿐이라
          고를 것이 없다 — 아무것도 하지 않는 가짜 드롭다운 대신 표시로만 둔다. */}
      <p className="border-b border-white/10 px-4 py-2.5 text-xs font-semibold text-white/70">Golf</p>

      <Link
        className="flex items-center gap-2 border-b border-white/10 bg-[#1c1f22] px-4 py-2.5 text-xs font-bold hover:bg-white/10"
        href={SITE_HOME}
      >
        <span aria-hidden>&#8962;</span>
        <span className="truncate">{CLUB.name}</span>
      </Link>

      <div className="flex items-baseline justify-between border-b border-white/10 px-4 py-2.5 text-[11px]">
        <span className="font-semibold">John Najev</span>
        <span className="text-white/50">Owner</span>
      </div>

      <nav aria-label="Club administration" className="grid gap-1 px-2 py-3 text-xs">
        {adminNav.map((item) => (
          <NavLink item={item} key={item.href} pathname={pathname} />
        ))}
      </nav>

      <div className="mx-3 mt-4 mb-4 bg-[#fffbd5] p-3 text-[11px] leading-5 text-[#2f2f21]">
        <p className="font-bold">Note</p>
        <p>John&apos;s Mobile #: 905-512-8755</p>
        <p>Login: Chronogolf</p>
        <p>Course: Pelham Hills</p>
      </div>
    </aside>
  );
}

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: { label: string; href: string; glyph: string };
  pathname: string | null;
  onClick?: () => void;
}) {
  const current = isActive(pathname, item.href);
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={`flex items-center gap-2 px-3 py-2 font-semibold ${
        current ? "bg-[#4533ff]" : "hover:bg-white/10"
      }`}
      href={item.href}
      onClick={onClick}
    >
      <span aria-hidden className="w-3.5 shrink-0 text-center opacity-80">
        {item.glyph}
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

// ===== 헤더 =============================================================

function DesktopHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="hidden items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-3 lg:flex">
      <div className="min-w-0">
        <p className="text-xs font-bold text-[#6b7280]">{CLUB.name}</p>
        <h1 className="truncate text-sm font-bold">{title}</h1>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  );
}

function MobileTopBar({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <header className="flex items-center gap-3 border-b border-[#d4d4d8] bg-[#111315] px-3 py-2.5 text-white lg:hidden">
      <button
        // 44px 은 손가락으로 눌러서 빗나가지 않는 최소 크기다. 아이콘만 두면
        // 8px 짜리 과녁이 되어 첫 번째 탭이 자주 빗나간다.
        aria-label="Open admin menu"
        className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-xl"
        onClick={onOpen}
        type="button"
      >
        <span aria-hidden>☰</span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold tracking-wide text-white/50 uppercase">
          {CLUB.shortName}
        </p>
        <h1 className="truncate text-sm font-bold">{title}</h1>
      </div>
    </header>
  );
}

// ===== 모바일 서랍 ======================================================

function MobileDrawer({
  open,
  onClose,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string | null;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* 뒷배경. 바깥을 눌러 닫는 것은 모바일에서 가장 자연스러운 취소 동작이다. */}
      <button
        aria-label="Close admin menu"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        type="button"
      />
      <div className="absolute inset-y-0 left-0 flex w-[82vw] max-w-[300px] flex-col bg-[#111315] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-bold">lightspeed</span>
          <button
            aria-label="Close admin menu"
            className="-mr-2 flex h-10 w-10 items-center justify-center text-xl"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        <Link
          className="flex items-center gap-2 border-b border-white/10 bg-[#1c1f22] px-4 py-3 text-xs font-bold"
          href={SITE_HOME}
          onClick={onClose}
        >
          <span aria-hidden>&#8962;</span>
          <span className="truncate">{CLUB.name}</span>
        </Link>

        <nav
          aria-label="Club administration"
          className="grid flex-1 content-start gap-1 overflow-y-auto px-2 py-3 text-sm"
        >
          {adminNav.map((item) => (
            <NavLink item={item} key={item.href} onClick={onClose} pathname={pathname} />
          ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-white/60">
          John Najev · Owner
        </div>
      </div>
    </div>
  );
}

// ===== 모바일 하단 탭 ===================================================

function MobileTabBar({ pathname }: { pathname: string | null }) {
  return (
    // pb-[env(safe-area-inset-bottom)]: 홈 인디케이터가 있는 아이폰에서 마지막
    // 탭 줄이 인디케이터에 가려 눌리지 않는 것을 막는다.
    <nav
      aria-label="Quick admin sections"
      className="grid grid-cols-4 border-t border-[#d4d4d8] bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {adminQuickNav.map((item) => {
        const current = isActive(pathname, item.href);
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-bold ${
              current ? "text-[#4533ff]" : "text-[#6b7280]"
            }`}
            href={item.href}
            key={item.href}
          >
            <span aria-hidden className="text-base leading-none">
              {item.glyph}
            </span>
            <span className="w-full truncate text-center">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** 어드민 링크가 서랍/사이드바 밖에서도 필요할 때 쓰는 재수출. */
export { ADMIN_HOME };
