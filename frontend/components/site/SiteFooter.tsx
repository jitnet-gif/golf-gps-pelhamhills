/**
 * 공개 사이트의 푸터.
 *
 * 예전에는 푸터가 아예 없었다. 홈을 끝까지 내리면 영업시간 표에서 페이지가 뚝
 * 끊겼고, 주소·전화·예약 링크를 다시 보려면 맨 위로 올라가야 했다. 골프장
 * 홈페이지에서 가장 자주 찾는 정보가 바로 그 셋이다.
 *
 * 서버 컴포넌트다 — 상태가 없다. `"use client"` 를 붙이지 마라.
 *
 * 직원용 도구(어드민) 링크가 여기 있는 이유: 방문자용 마케팅 헤더에 "Admin" 이
 * 있을 이유가 없다. 직원은 이 링크를 한 번 눌러 북마크하면 그만이므로,
 * 푸터 맨 아래 작은 글씨가 알맞은 자리다.
 */

import Link from "next/link";

import { clubHours } from "@/components/site/clubHours";
import { ADMIN_HOME, BOOK_HOME, CLUB, bookNav, siteNav } from "@/lib/nav";

export default function SiteFooter() {
  return (
    <footer className="border-t border-[#3a5a3f] bg-[#182118] text-[#dfe6dd]">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:px-8 lg:py-16">
        <div>
          <p className="font-serif text-xl font-semibold tracking-[0.08em] text-white">
            {CLUB.name}
          </p>
          <p className="mt-4 text-sm leading-7">{CLUB.address}</p>
          <p className="text-sm leading-7">
            <a className="font-bold text-[#d6c28f]" href={CLUB.phoneHref}>
              {CLUB.phone}
            </a>
          </p>
          <p className="text-sm leading-7">
            <a className="font-bold text-[#d6c28f]" href={CLUB.emailHref}>
              {CLUB.email}
            </a>
          </p>
          <p className="mt-4 text-xs tracking-[0.16em] text-[#8fa38c] uppercase">
            {CLUB.established}
          </p>
        </div>

        <FooterColumn title="Explore">
          {siteNav.map((item) => (
            <FooterLink href={item.href} key={item.href}>
              {item.label}
            </FooterLink>
          ))}
        </FooterColumn>

        <FooterColumn title="Book">
          {bookNav.map((item) => (
            <FooterLink href={item.href} key={item.href}>
              {item.label}
            </FooterLink>
          ))}
          <FooterLink href={BOOK_HOME}>All Booking Options</FooterLink>
        </FooterColumn>

        <FooterColumn title="Hours">
          {/* 홈의 "Visit" 표와 같은 배열을 읽는다 — 시간이 바뀌었을 때 한쪽만
              고쳐서 같은 페이지에 두 가지 영업시간이 뜨는 일을 막는다. */}
          {clubHours
            .filter((entry) => entry.primary)
            .map((entry) => (
              <li className="text-sm leading-6" key={entry.label}>
                <span className="font-bold text-white">{entry.label}</span>
                <br />
                {entry.value}
              </li>
            ))}
        </FooterColumn>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs text-[#8fa38c] sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p>
            &copy; {new Date().getFullYear()} {CLUB.name}. Welland, Ontario.
          </p>
          <Link
            className="-my-2 flex min-h-11 items-center self-start font-semibold text-[#8fa38c] hover:text-white"
            href={ADMIN_HOME}
          >
            Staff Login
          </Link>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold tracking-[0.2em] text-[#d6c28f] uppercase">{title}</p>
      {/* gap-3 + 링크의 py-1.5: 14px 글자를 gap-2 로 붙여 놓으면 과녁 간격이
          8px 밖에 안 되어 휴대폰에서 옆 줄이 눌린다. 데스크톱 모양은 그대로다. */}
      <ul className="mt-4 grid gap-3">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  external = false,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      {external ? (
        // 외부 사이트로 나가는 링크는 새 탭으로 연다 — 예약하러 온 사람이
        // 회원권 안내를 눌렀다고 이 사이트를 잃어버리면 안 된다.
        <a
          className="block py-1.5 text-sm hover:text-white"
          href={href}
          rel="noreferrer"
          target="_blank"
        >
          {children}
        </a>
      ) : href.includes("#") ? (
        // 같은 문서 안의 앵커는 `<Link>` 대신 평범한 앵커로 둔다. 현재 경로로
        // 가는 App Router 의 해시 이동은 두 번째 클릭부터 맨 위로 튀는 등
        // 동작이 일정하지 않은 반면, 브라우저 기본 동작은 항상 같다
        // (섹션의 `scroll-mt-*` 덕에 sticky 헤더에도 가리지 않는다).
        <a className="block py-1.5 text-sm hover:text-white" href={href}>
          {children}
        </a>
      ) : (
        <Link className="block py-1.5 text-sm hover:text-white" href={href}>
          {children}
        </Link>
      )}
    </li>
  );
}
