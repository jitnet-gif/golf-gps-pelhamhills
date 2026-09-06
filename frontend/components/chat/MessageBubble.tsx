import { useState, useEffect } from "react"
import BepuAvatar from "@/components/bepu/BepuAvatar"
import type { Message } from "@/lib/types"
import { linkify } from "@/lib/linkify"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  agentId?: string
  isMuted?: boolean
  isLastMessage?: boolean
  ttsVoice?: string
  ttsRate?: number
  language?: string // 언어 정보 추가
}

export default function MessageBubble({
  message,
  isStreaming,
  agentId = "david",
  isMuted = false,
  isLastMessage = false,
  ttsVoice,
  ttsRate = 1.0,
  language = "ko",
}: MessageBubbleProps) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [playedIndex, setPlayedIndex] = useState(0) // 마지막으로 읽은 문장의 인덱스
  const [sentenceQueue, setSentenceQueue] = useState<string[]>([])
  const isBepu = message.role === "assistant" || message.role === "system"

  // 스트리밍 중 문장 단위로 끊어서 TTS 큐에 추가
  useEffect(() => {
    if (!isStreaming || isMuted || !isLastMessage) return

    const sentences = message.content.split(/[.!?\n]/).filter(s => s.trim().length > 0)
    if (sentences.length > sentenceQueue.length) {
      const newSentences = sentences.slice(sentenceQueue.length)
      setSentenceQueue(sentences)

      // 새로운 문장이 들어오면 순차적으로 재생 시도
      if (!isSpeaking) {
        const nextIdx = playedIndex
        if (nextIdx < sentences.length) {
          handleTTS(sentences[nextIdx]).then(() => {
            setPlayedIndex(nextIdx + 1)
          })
        }
      }
    }
  }, [message.content, isStreaming, isMuted, isLastMessage, sentenceQueue.length, isSpeaking, playedIndex])

  // 큐에 쌓인 문장들을 순차적으로 재생하는 감시 로직
  useEffect(() => {
    if (isSpeaking || isMuted) return
    if (playedIndex < sentenceQueue.length) {
      handleTTS(sentenceQueue[playedIndex]).then(() => {
        setPlayedIndex(prev => prev + 1)
      })
    }
  }, [playedIndex, sentenceQueue, isSpeaking, isMuted])

  async function handleTTS(textOverride?: string) {
    let rawText = textOverride || message.content
    if (!rawText || typeof window === "undefined" || !window.speechSynthesis) return

    // 1. 유니코드 이모지 제거 
    let cleanText = rawText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F093}\u{1F191}-\u{1F251}\u{1F004}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2194}-\u{2199}\u{2B1B}-\u{2B1C}\u{231A}-\u{231B}\u{23E9}-\u{23EC}\u{23F0}\u{23F3}]/gu, "")

    // 2. 한국어 자음/모음 반복 이모티콘 제거 (ㅎㅎ, ㅠㅠ, ㅋㅋ 등)
    cleanText = cleanText.replace(/[ㄱ-ㅎㅏ-ㅣ]{2,}/gu, "")

    // 3. 이모지 및 특수문자 제거 (TTS에서 읽지 않도록)
    cleanText = cleanText.replace(/([\u{1F300}-\u{1F5FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])/gu, "")

    const text = cleanText.replace(/\s+/g, " ").trim()

    // 만약 이모지를 지웠는데 텍스트가 없으면(이모지만 있는 경우) 재생 안 함
    if (!text) return Promise.resolve()

    return new Promise<void>((resolve) => {
      setIsSpeaking(true)

      // 수동 클릭 시에만 기존 음성 중지
      if (!textOverride) window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      const voices = window.speechSynthesis.getVoices()

      // 언어 코드 매핑 (ko -> ko-KR, ja -> ja-JP 등)
      const langMap: Record<string, string> = {
        "ko": "ko-KR",
        "en": "en-US",
        "ja": "ja-JP",
        "zh": "zh-CN",
        "vi": "vi-VN"
      }
      const targetLangCode = langMap[language] || "ko-KR"

      if (ttsVoice) {
        const selectedVoice = voices.find(v => v.name === ttsVoice)
        if (selectedVoice) utterance.voice = selectedVoice
      } else {
        // 선택 언어의 구글 보이스 최우선 선택
        const googleVoice = voices.find(v => v.lang.includes(language) && v.name.includes("Google"))
        const anyLangVoice = voices.find(v => v.lang.includes(language))
        if (googleVoice) utterance.voice = googleVoice
        else if (anyLangVoice) utterance.voice = anyLangVoice
      }

      utterance.lang = targetLangCode
      utterance.rate = ttsRate

      // 언어별/성격별 Pitch 미세 조정
      const isMaleId = (agentId === "david" || agentId === "liam" || agentId === "junho")
      if (language === "ko") {
        utterance.pitch = isMaleId ? 0.9 : 1.1
      } else {
        utterance.pitch = 1.0 // 다국어는 기본값 권장
      }

      utterance.onend = () => {
        setIsSpeaking(false)
        resolve()
      }

      utterance.onerror = (event) => {
        // interrupted는 의도적 중단이므로 무시, not-allowed도 스트리밍 중에는 경고만
        if (event.error !== 'interrupted' && event.error !== 'not-allowed') {
          console.error("TTS Error:", event)
        }
        setIsSpeaking(false)
        resolve()
      }

      window.speechSynthesis.speak(utterance)
    })
  }

  // AI 모델별 브랜드 스타일 정의 함수
  const getModelInfo = (modelName: string = "") => {
    const name = modelName.toLowerCase()
    if (name.includes("gpt") || name.includes("openai")) return {
      label: "OpenAI GPT",
      color: "bg-[#10a37f]",
      textColor: "text-white",
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5153-4.9066 6.0462 6.0462 0 0 0-4.3912-3.1114 6.0422 6.0422 0 0 0-5.283 1.2421 6.0413 6.0413 0 0 0-6.2609-.1341 6.0442 6.0442 0 0 0-3.3727 4.5422 6.043 6.043 0 0 0 1.2599 5.285 5.982 5.982 0 0 0 .5153 4.9066 6.0462 6.0462 0 0 0 4.3912 3.1114 6.0422 6.0422 0 0 0 5.283-1.2421 6.0413 6.0413 0 0 0 6.2609.1341 6.0442 6.0442 0 0 0 3.3727-4.5422 6.043 6.043 0 0 0-1.2599-5.285zm-9.3371 11.2312a4.4933 4.4933 0 0 1-2.5885-.8136l.1011-.0584 3.9965-2.3073a.4651.4651 0 0 0 .2326-.4028v-5.6923l2.2033 1.272a.0163.0163 0 0 1 .0082.0141v4.4539a4.5126 4.5126 0 0 1-3.9532 3.5344zm-9.2272-5.4628a4.4752 4.4752 0 0 1-.2253-2.7032l.0964.0557 3.9965 2.3073a.4651.4651 0 0 0 .4651 0l4.9298-2.8462v2.5441a.0163.0163 0 0 1-.0082.0141l-3.8571 2.227a4.5126 4.5126 0 0 1-5.4055-.1012l.0083.0024zm-1.2982-10.1983a4.4752 4.4752 0 0 1 2.3632-1.3116l-.0047.1141v4.6146a.4651.4651 0 0 0 .2326.4028l4.9298 2.8462-2.2033 1.272a.0163.0163 0 0 1-.0163 0L3.107 10.9705a4.5126 4.5126 0 0 1-1.291-5.7194l-.0044-.002zm17.9103 4.4539l-3.9965-2.3073a.4651.4651 0 0 0-.4651 0L10.383 10.9705v-2.5441a.0163.0163 0 0 1 .0082-.0141l3.8571-2.227a4.5126 4.5126 0 0 1 5.6308 2.8043l-.0062.0141zm1.2982 10.1983a4.4752 4.4752 0 0 1-2.3632 1.3116l.0047-.1141v-4.6146a.4651.4651 0 0 0-.2326-.4028l-4.9298-2.8462 2.2033-1.272a.0163.0163 0 0 1 .0163 0l3.8571 2.227a4.5126 4.5126 0 0 1 1.291 5.7194l.0532-.0073zm-10.0384-6.3073l-2.2033-1.272a.0163.0163 0 0 1-.0082-.0141v-4.4539a4.5126 4.5126 0 0 1 3.9532-3.5344l-.1011.0583-3.9965 2.3073a.4651.4651 0 0 0-.2326.4028l-.0115 6.5064zm1.1852-.3924l2.7663-1.5971-2.7663-1.5971L9.1867 11.233l2.7663 1.5971 2.7663 1.5971z" /></svg>
    }
    if (name.includes("claude") || name.includes("anthropic")) return {
      label: "Claude (Anthropic)",
      color: "bg-[#d97e5d]",
      textColor: "text-white",
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" /></svg>
    }
    if (name.includes("gemini") || name.includes("google")) return {
      label: "Google Gemini",
      color: "bg-[#1a73e8]",
      textColor: "text-white",
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" /></svg>
    }
    if (name.includes("perplexity")) return {
      label: "Perplexity AI",
      color: "bg-[#20b2aa]",
      textColor: "text-white",
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>
    }
    if (name.includes("mistral")) return {
      label: "Mistral AI",
      color: "bg-[#ff7000]",
      textColor: "text-white",
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12.16 3.2L1.84 9.17v11.64l10.32-5.96 10.32 5.96V9.17L12.16 3.2z" /></svg>
    }
    if (name.includes("copilot") || name.includes("microsoft")) return {
      label: "MS Copilot",
      color: "bg-[#00a1f1]",
      textColor: "text-white",
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" /></svg>
    }
    return {
      label: (modelName || "AI BEPU Agent").toUpperCase(),
      color: "bg-black/10",
      textColor: "text-black/60",
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
    }
  }

  const modelStyle = getModelInfo(message.model_name)

  // 감정에 따른 아바타 무드 결정 (렌더링 직전에 확정)
  const avatarMood = message.detected_emotion === "stressed" ? "concerned"
    : message.detected_emotion === "happy" ? "excited"
      : "default"

  return (
    <div className={`flex w-full gap-2.5 mb-5 ${isBepu ? "justify-start" : "justify-end"} items-end`}>
      {isBepu && (
        <div className="flex-shrink-0 z-10 -mb-1">
          <BepuAvatar mood={isStreaming ? "thinking" : avatarMood as any} size={42} />
        </div>
      )}

      <div className="flex flex-col gap-1.5 max-w-[78%]">
        <div
          className={`relative px-4 py-3.5 text-[15px] leading-[1.6] whitespace-pre-wrap break-words shadow-sm font-medium transition-all
            ${isBepu
              ? "bg-bepu-bubble text-bepu-text rounded-[24px] rounded-bl-[8px] border border-white/50 backdrop-blur-sm"
              : "bg-bepu-coral text-white rounded-[24px] rounded-br-[8px] shadow-bepu-coral/20"
            }`}
        >
          {isBepu && (
            <div className="flex items-center justify-between gap-4 mb-1.5">
              <span className="block text-[11px] font-bold text-black/30">베푸 💬</span>

              {/* 모델 정보 상단 노출 (스트리밍 중에도 표시) */}
              {(message.model_name || isStreaming) && (
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${modelStyle.color} ${modelStyle.textColor} text-[9px] font-bold shadow-sm animate-in fade-in slide-in-from-right-2 duration-500`}>
                  {modelStyle.icon}
                  <span className="opacity-90">{modelStyle.label}</span>
                </div>
              )}
            </div>
          )}

          <div className={isBepu ? "bepu-content" : "user-content"}>
            {linkify(message.content)}
          </div>

          {isStreaming && isBepu && (
            <span className="inline-block w-1 h-4 bg-bepu-coral/60 ml-1 rounded-full animate-pulse align-middle" />
          )}
        </div>

        {/* 하단 컨트롤 영역 */}
        {isBepu && !isStreaming && message.content && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setPlayedIndex(sentenceQueue.length)
                handleTTS()
              }}
              disabled={isSpeaking}
              className={`flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-full text-[11px] font-bold transition-all
                ${isSpeaking
                  ? "bg-bepu-blue text-white animate-pulse"
                  : "bg-bepu-blue/10 text-bepu-blue hover:bg-bepu-blue/20 active:scale-95 shadow-sm"
                }`}
            >
              {isSpeaking ? (
                <>
                  <div className="flex gap-0.5">
                    {[0, 100, 200].map(delay => (
                      <div key={delay} className="w-1 h-2.5 bg-current rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                  <span>말하는 중...</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
                  <span>다시 듣기</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
