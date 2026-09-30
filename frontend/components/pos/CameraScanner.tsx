"use client";

/**
 * 휴대폰·아이패드 카메라를 **마트 계산대 스캐너**처럼 쓴다. 켜 둔 채로 물건을 비추면
 * 읽을 때마다 `onCode` 가 불리고, 받는 쪽이 계산서에 담는다. 결제 버튼을 누를 때까지 닫히지 않는다.
 *
 * 왜 ZXing 인가: 브라우저 내장 `BarcodeDetector` 는 안드로이드 Chrome 에만 있고
 * 아이폰·아이패드 Safari 에는 없다. 카운터 밖의 실사용 기기가 아이패드라 라이브러리로 읽는다.
 * 무거워서(수백 KB) 이 화면이 열릴 때만 `import()` 로 부른다.
 *
 * 카메라는 1초에 수십 번 읽는다. 들고 있는 동안 같은 물건이 계속 담기지 않도록
 * **같은 코드는 한 번 담은 뒤 화면에서 사라졌다가 다시 보여야** 또 담는다(아래 `SAME_CODE_GAP_MS`).
 * 같은 물건 두 개는 하나 찍고, 치웠다가, 다시 비추면 된다.
 *
 * 카메라는 HTTPS(또는 localhost)에서만 켜진다. 배포 주소는 HTTPS 다.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export type ScanOutcome = { ok: boolean; message: string };

type Props = {
  /** 읽은 코드. 담았으면 ok, 모르는 코드면 ok:false 와 이유. */
  onCode: (code: string) => Promise<ScanOutcome>;
  /** "결제" — 카메라를 닫고 계산서 결제 칸으로. */
  onDone: () => void;
  /** 결제 없이 닫기. */
  onClose: () => void;
  /** 화면 아래 줄에 보일 계산서 요약(줄 수·합계). */
  summary: ReactNode;
  /** 결제 버튼을 누를 수 있는가(담긴 게 있는가). */
  canPay: boolean;
};

/**
 * 같은 코드가 이 시간 동안 **보이지 않아야** 다시 담는다. 카메라가 같은 바코드를
 * 계속 읽는 동안에는 시계가 갱신되므로, 들고만 있으면 절대 두 번 담기지 않는다.
 */
const SAME_CODE_GAP_MS = 1200;

/** 매장에서 붙는 1D 바코드 + 영수증의 Code 128 + QR. 형식을 좁히면 읽는 속도가 빨라진다. */
const FORMAT_NAMES = [
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "CODE_128",
  "CODE_39",
  "ITF",
  "QR_CODE",
] as const;

type Flash = { ok: boolean; message: string; at: number };

export default function CameraScanner({ onCode, onDone, onClose, summary, canPay }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "live" | "error">("starting");
  const [problem, setProblem] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);

  // 콜백은 매 렌더 바뀐다. 카메라를 다시 켜지 않도록 ref 로 최신 것만 들고 있는다.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const audioRef = useRef<AudioContext | null>(null);

  /**
   * 아이폰은 사용자가 화면을 한 번 건드려야 소리를 허락한다. 스캔 모드를 연 버튼의 탭으로
   * 대개 충분하지만, 바로가기 주소로 바로 열린 경우를 위해 화면 어디든 누르면 다시 깨운다.
   */
  function unlockAudio() {
    try {
      if (!audioRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) audioRef.current = new Ctor();
      }
      void audioRef.current?.resume();
    } catch {
      // 소리가 안 나도 스캔은 된다.
    }
  }

  function beep(ok: boolean) {
    const ctx = audioRef.current;
    if (ctx && ctx.state === "running") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ok ? "sine" : "square";
      osc.frequency.value = ok ? 1760 : 220;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.09 : 0.35));
    }
    // 안드로이드만. 아이폰 Safari 에는 진동 API 가 없다.
    navigator.vibrate?.(ok ? 40 : [80, 60, 80]);
  }

  useEffect(() => {
    unlockAudio();
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    let lastCode = "";
    let lastSeen = 0;
    let busy = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setProblem("This browser cannot open the camera. Use Safari or Chrome over https.");
        return;
      }
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (stopped) return;
        const hints = new Map();
        hints.set(
          DecodeHintType.POSSIBLE_FORMATS,
          FORMAT_NAMES.map((name) => BarcodeFormat[name]),
        );
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 80,
          delayBetweenScanSuccess: 80,
        });
        const video = videoRef.current;
        if (!video) return;
        // 아이폰은 이 둘이 없으면 전체 화면 플레이어로 튀어나가거나 재생을 거부한다.
        video.muted = true;
        video.setAttribute("playsinline", "true");

        const started = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          video,
          (result) => {
            if (!result) return;
            const code = result.getText().trim();
            const now = Date.now();
            const repeat = code === lastCode && now - lastSeen < SAME_CODE_GAP_MS;
            lastSeen = now;
            if (repeat || busy || !code) return;
            lastCode = code;
            busy = true;
            void onCodeRef
              .current(code)
              .then((outcome) => {
                beep(outcome.ok);
                setFlash({ ...outcome, at: now });
              })
              .finally(() => {
                busy = false;
                // 담는 동안(서버 왕복) 계속 비추고 있었다면 그 시간도 "보이는 중" 으로 친다.
                lastSeen = Date.now();
              });
          },
        );
        if (stopped) {
          started.stop();
          return;
        }
        controls = started;
        setStatus("live");
      } catch (cause) {
        if (stopped) return;
        const name = (cause as { name?: string })?.name ?? "";
        setStatus("error");
        setProblem(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow the camera for this site in the browser settings, then try again."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera was found on this device."
              : "The camera could not start. Close other apps using the camera and try again.",
        );
      }
    }

    void start();
    return () => {
      stopped = true;
      controls?.stop();
      void audioRef.current?.close().catch(() => undefined);
      audioRef.current = null;
    };
    // 한 번만 켠다. 콜백은 ref 로 최신을 쓴다.
  }, []);

  // 결과 문구는 잠깐만 보인다.
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), flash.ok ? 1600 : 3500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // Esc 로 닫기(블루투스 키보드를 붙인 아이패드).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    // z-[60]: 어드민 서랍(z-50)과 계산서 시트(z-40) 위.
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
      onPointerDown={unlockAudio}
      role="dialog"
      aria-label="Camera barcode scanner"
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
        <h2 className="text-sm font-bold">Camera scan</h2>
        <button
          aria-label="Close camera"
          className="flex min-h-11 min-w-11 items-center justify-center text-2xl leading-none"
          onClick={onClose}
          type="button"
        >
          <span aria-hidden>×</span>
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video className="absolute inset-0 h-full w-full object-cover" ref={videoRef} />

        {/* 조준 틀. 바코드를 이 안에 넣으라는 표시일 뿐, 읽기는 화면 전체에서 한다. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`h-[28%] w-[80%] max-w-md border-2 transition-colors ${
              flash ? (flash.ok ? "border-[#3ddc84]" : "border-[#ff5a5a]") : "border-white/80"
            }`}
          />
        </div>

        {status === "starting" ? (
          <p className="absolute inset-x-0 top-1/2 text-center text-sm">Starting camera…</p>
        ) : null}
        {status === "error" ? (
          <div className="absolute inset-x-4 top-1/3 bg-[#1f1f23] p-4 text-sm">
            <p className="font-bold">Camera unavailable</p>
            <p className="mt-1 text-[#d4d4d8]">{problem}</p>
          </div>
        ) : null}
        {status === "live" && !flash ? (
          <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white/85">
            Hold a barcode inside the box. Same item again? Move it away, then back.
          </p>
        ) : null}

        {flash ? (
          <div
            aria-live="assertive"
            className={`absolute inset-x-3 bottom-3 px-3 py-2.5 text-sm font-bold ${
              flash.ok ? "bg-[#12713a]" : "bg-[#8a1f1f]"
            }`}
            key={flash.at}
          >
            {flash.ok ? "✓ " : "✕ "}
            {flash.message}
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 bg-white px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] text-[#111]">
        <div className="min-w-0">{summary}</div>
        <button
          className="min-h-12 shrink-0 bg-[#4533ff] px-5 text-sm font-bold text-white disabled:opacity-40"
          disabled={!canPay}
          onClick={onDone}
          type="button"
        >
          Pay
        </button>
      </footer>
    </div>
  );
}
