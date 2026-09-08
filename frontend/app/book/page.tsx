"use client";

/**
 * 예약 허브 — 공개 사이트의 모든 "Book" CTA 가 도착하는 곳.
 *
 * 여기서 하는 일은 하나다: **손님이 무엇을 예약하러 왔는지 고르게 하는 것.**
 * 코스 티타임과 실내 시뮬레이터는 영업시간도, 가격 단위도, 폼도 전혀 다르다.
 * 한 화면에 섞으면 "1시간 · 베이" 와 "4인 · 18홀" 이 같은 폼에서 싸운다.
 */

import Link from "next/link";

import BookingShell from "@/components/booking/BookingShell";
import { CLUB, bookNav } from "@/lib/nav";

type Choice = {
  href: string;
  image: string;
  eyebrow: string;
  title: string;
  blurb: string;
  hours: string;
  cta: string;
};

const CHOICES: Choice[] = [
  {
    // 주소는 `lib/nav.ts` 에서 가져온다. 하드코딩하면 메뉴와 카드가 언젠가 어긋난다.
    href: bookNav[0].href,
    image: "/pelham-hills/hero-course.png",
    eyebrow: "On the course",
    title: "Tee Times",
    blurb: "Book 9 or 18 holes on the championship course, up to four players per tee time.",
    hours: "Daily · first tee 6:40 AM, last tee 6:00 PM",
    cta: "Find a tee time",
  },
  {
    href: bookNav[1].href,
    image: "/pelham-hills/course-detail.png",
    eyebrow: "Indoor",
    title: "Indoor Golf",
    blurb: "Reserve a simulator bay by the hour — play world courses or work on your swing.",
    hours: "Wednesday–Sunday · 2:00 PM – 10:00 PM",
    cta: "Reserve a bay",
  },
];

export default function BookHubPage() {
  return (
    <BookingShell
      subtitle="Choose what you would like to reserve. Booking takes about a minute."
      title="Book at Pelham Hills"
    >
      {/* 모바일 세로 두 장, 데스크톱 가로 두 장. 트랙을 minmax(0,1fr) 로 못박는다 —
          auto 트랙은 max-content 로 부풀어 긴 문장 하나가 페이지를 가로로 민다. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {CHOICES.map((choice) => (
          <article
            key={choice.href}
            className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-[#d8d1c3] bg-white"
          >
            {/* next/image 를 쓰지 않는다: `output: "export"` 에서는 이미지 최적화가
                꺼져 있어야 하는데 이 저장소는 그 설정을 두지 않았다. */}
            <img
              alt=""
              className="h-44 w-full object-cover sm:h-52"
              loading="lazy"
              src={choice.image}
            />
            <div className="flex min-w-0 flex-1 flex-col p-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a6f30]">
                {choice.eyebrow}
              </p>
              <h2 className="mt-1 font-serif text-2xl font-semibold">{choice.title}</h2>
              <p className="mt-2 text-sm text-[#3d453d]">{choice.blurb}</p>
              <p className="mt-3 text-sm text-[#5c6459]">{choice.hours}</p>
              <Link
                className="tap-target mt-5 flex items-center justify-center rounded-sm bg-[#214d2f] px-6 text-base font-bold text-white transition hover:bg-[#163820]"
                href={choice.href}
              >
                {choice.cta}
              </Link>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-sm border border-[#d6c28f] bg-[#f3ead2] p-4 text-sm text-[#5c4a1c]">
        <p className="font-semibold">Already booked?</p>
        <p className="mt-1">
          Look up an existing reservation with your confirmation code on the{" "}
          <Link className="font-semibold underline" href={bookNav[2].href}>
            {bookNav[2].label}
          </Link>{" "}
          page, or call the pro shop at{" "}
          <a className="font-semibold underline" href={CLUB.phoneHref}>
            {CLUB.phone}
          </a>
          .
        </p>
      </div>
    </BookingShell>
  );
}
