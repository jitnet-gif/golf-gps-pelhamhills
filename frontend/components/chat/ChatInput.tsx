"use client"

import { useState, useRef, KeyboardEvent, useEffect } from "react"
import { ADVANCED_FEATURES, AdvancedFeature } from "@/constants/features"

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("")
  const [activeFeature, setActiveFeature] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const recognitionRef = useRef<any>(null)
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return

    // 만약 활성화된 기능이 있다면 접두사 붙여서 전송
    const feature = ADVANCED_FEATURES.find(f => f.id === activeFeature)
    const finalContent = feature && !trimmed.startsWith(feature.promptPrefix || "")
      ? `${feature.promptPrefix}${trimmed}`
      : trimmed

    // 전송 시 녹음 중이면 중지
    if (isRecording && recognitionRef.current) {
      try {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = null
        }
        recognitionRef.current.stop()
        setIsRecording(false)
      } catch (e) {
        console.error("STT stop error during send:", e)
      }
    }

    onSend(finalContent)
    setValue("")
    setActiveFeature(null) // 전송 후 초기화

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  // Speech Recognition 초기화 및 로직
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = localStorage.getItem("BEPU_LANGUAGE") === "ko" ? "ko-KR" :
          localStorage.getItem("BEPU_LANGUAGE") === "en" ? "en-US" :
            localStorage.getItem("BEPU_LANGUAGE") === "ja" ? "ja-JP" : "ko-KR"

        const resetSilenceTimer = () => {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
          }
          silenceTimerRef.current = setTimeout(() => {
            if (recognitionRef.current) {
              recognitionRef.current.stop()
              setIsRecording(false)
            }
          }, 1500) // 1.5초 무음 감지
        }

        recognition.onresult = (event: any) => {
          resetSilenceTimer() // 인식 결과 올 때마다 타이머 리셋
          let interimTranscript = ""
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              setValue(prev => prev + event.results[i][0].transcript)
            } else {
              interimTranscript += event.results[i][0].transcript
            }
          }
        }

        recognition.onend = () => {
          setIsRecording(false)
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        }

        recognition.onerror = (event: any) => {
          console.error("STT Error:", event.error)
          setIsRecording(false)
        }

        recognitionRef.current = recognition
      }
    }
  }, [])

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("이 브라우저는 음성 인식을 지원하지 않습니다. 크롬을 권장해요! 😊")
      return
    }

    if (isRecording) {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      try {
        recognitionRef.current.stop()
      } catch (e) {
        console.error("STT stop error:", e)
      }
      setIsRecording(false)
    } else {
      // 새로운 녹음 시작 전 기존 상태 확실히 초기화
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }

      // 혹시 모를 내부 상태 고임 방지를 위해 abort 시도 후 start
      try {
        if ((recognitionRef.current as any).state === 'recording') {
          recognitionRef.current.abort()
        }
      } catch (e) { }

      setIsRecording(true)
      const currentLang = localStorage.getItem("BEPU_LANGUAGE") || "ko"
      const langMap: Record<string, string> = { "ko": "ko-KR", "en": "en-US", "ja": "ja-JP", "zh": "zh-CN", "vi": "vi-VN" }
      recognitionRef.current.lang = langMap[currentLang] || "ko-KR"

      setTimeout(() => {
        try {
          recognitionRef.current!.start()
        } catch (e) {
          console.error("STT start retry error:", e)
          if (e instanceof Error && e.message.includes("already started")) {
            setIsRecording(true)
          } else {
            setIsRecording(false)
          }
        }
      }, 50) // 약간의 딜레이를 주어 이전 인스턴스 정리가 끝나길 기다림
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  const toggleFeature = (feature: AdvancedFeature) => {
    if (activeFeature === feature.id) {
      setActiveFeature(null)
    } else {
      setActiveFeature(feature.id)
      // 시각적 피드백을 위해 포커스
      textareaRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* 고도화 기능 툴바 */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar -mx-2 px-2 scroll-smooth">
        {ADVANCED_FEATURES.map((feature) => (
          <button
            key={feature.id}
            onClick={() => toggleFeature(feature)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full whitespace-nowrap text-[13px] font-bold transition-all duration-300 border
              ${activeFeature === feature.id
                ? `bg-bepu-blue text-white border-bepu-blue shadow-lg shadow-bepu-blue/20 scale-105`
                : "bg-white text-gray-500 border-gray-100 hover:border-bepu-blue/30 hover:bg-gray-50 active:scale-95"
              }`}
          >
            <span className="text-base leading-none">{feature.icon}</span>
            <span>{feature.label}</span>
          </button>
        ))}
      </div>

      <div className={`flex items-end gap-2.5 bg-white border rounded-[28px] px-4 py-2.5 shadow-sm transition-all focus-within:ring-2 ring-bepu-blue/20
        ${activeFeature ? "border-bepu-blue/50 ring-2" : "border-bepu-blue/30"}
      `}>

        {/* 첨부 버튼들 */}
        <div className="flex shrink-0 gap-1 pb-1">
          <button className="p-1.5 text-gray-400 hover:text-bepu-blue transition-colors rounded-full hover:bg-gray-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {activeFeature && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 mb-1 animate-in fade-in slide-in-from-left-2 duration-300">
              <span className="text-[10px] font-black uppercase tracking-widest text-bepu-blue bg-bepu-blue/5 px-1.5 rounded">
                {ADVANCED_FEATURES.find(f => f.id === activeFeature)?.label} Mode Active
              </span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            disabled={disabled}
            rows={1}
            placeholder={activeFeature ? `${activeFeature.replace('-', ' ').toUpperCase()} 에 대해 말해봐` : "베푸야~ 말해봐"}
            className="flex-1 min-w-0 resize-none outline-none text-[15px] text-bepu-text placeholder-gray-400 bg-transparent py-1.5 max-h-[120px]"
            style={{ height: "32px", minHeight: "32px" }}
          />
        </div>

        <div className="flex shrink-0 gap-1.5 pb-0.5">
          {value.trim() ? (
            <button
              onClick={handleSend}
              disabled={disabled}
              className={`w-9 h-9 flex items-center justify-center rounded-full text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50
                ${activeFeature ? "bg-bepu-blue shadow-bepu-blue/30" : "bg-bepu-coral shadow-bepu-coral/30"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg>
            </button>
          ) : (
            <button
              onClick={toggleRecording}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-300 relative
                ${isRecording
                  ? "bg-red-500 text-white shadow-lg shadow-red-500/40 animate-pulse scale-110"
                  : "bg-bepu-mint/20 text-teal-600 hover:bg-bepu-mint/40"}`}
            >
              {isRecording && (
                <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-25" />
              )}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
