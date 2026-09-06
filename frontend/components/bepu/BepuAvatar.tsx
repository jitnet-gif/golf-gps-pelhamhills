"use client"

type Mood = "default" | "thinking" | "happy" | "concerned" | "excited"

interface BepuAvatarProps {
  mood?: Mood
  size?: number
  isTyping?: boolean
}

// 기획안 기반 파스텔 컬러맵
const moodColors: Record<Mood, string> = {
  default: "var(--color-bepu-coral)", // 기본 코랄
  thinking: "var(--color-bepu-blue)",  // 부드러운 블루
  happy: "var(--color-bepu-mint)",  // 상쾌한 민트
  concerned: "#FDE047",                 // 따뜻한 옐로우 (위로)
  excited: "#F472B6",                 // 핑크
}

const moodEmoji: Record<Mood, string> = {
  default: "🐰",      // 베푸 기본 아바타 이모지 대체
  thinking: "🤔",
  happy: "🥰",
  concerned: "🥺",
  excited: "✨",
}

export default function BepuAvatar({
  mood = "default",
  size = 40,
  isTyping = false,
}: BepuAvatarProps) {
  const color = moodColors[mood]
  const emoji = moodEmoji[mood]

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="rounded-full flex items-center justify-center text-white font-bold transition-all duration-500 will-change-transform shadow-md border-2 border-white/60"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          fontSize: size * 0.45,
          animation: isTyping ? "bounce 1.5s ease-in-out infinite" : undefined,
        }}
      >
        <span className="drop-shadow-sm">{emoji}</span>
      </div>

      {/* 타이핑 인디케이터 - 아바타 하단에 분리표시 */}
      {isTyping && (
        <div className="flex gap-1 bg-white/80 px-2 py-1 rounded-full border border-gray-100 shadow-sm">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-bepu-coral/70"
              style={{ animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
