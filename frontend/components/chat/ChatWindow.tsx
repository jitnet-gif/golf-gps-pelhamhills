"use client"

import { useState, useRef, useEffect } from "react"
import { v4 as uuidv4 } from "uuid"
import MessageBubble from "./MessageBubble"
import ChatInput from "./ChatInput"
import SettingsModal from "./SettingsModal"
import AgentPresenceManager, { PresenceStatus } from "./AgentPresenceManager"
import DebugPanel, { DebugLog } from "./DebugPanel"
import BepuAvatar from "@/components/bepu/BepuAvatar"
import type { Message, EmotionState } from "@/lib/types"
import { askGeminiStream, type GeminiMessage } from "@/lib/gemini"
import AgentSelector from "./AgentSelector"
import { AGENTS } from "@/constants/agents"
import { apiHost } from "@/lib/apiHost"

// 캐릭터별 인사말 생성 헬퍼
function getAgentGreeting(agentId: string, userName: string) {
  if (agentId === "david") return `반가워, ${userName}. 전략의 마스터 DAVID다. 효율적인 해결책이 필요하면 언제든 말해.`
  if (agentId === "sarah") return `안녕, ${userName}! 데이터의 여왕 SARAH야. 오늘 우리가 파헤칠 재미있는 정보는 뭐야?`
  if (agentId === "liam") return `${userName}아, 기다리고 있었어. 기술의 수호자 LIAM이야. 도움이 필요하면 내가 곁에 있을게.`
  if (agentId === "chloe") return `꺄! ${userName}! 창의의 불꽃 CHLOE 등장! 오늘 우리 세상을 얼마나 더 아름답게 만들어볼까?`
  if (agentId === "minji") return `${userName}님! 열정의 엔진 민지에요! 오늘 하루도 저랑 같이 힘차게 달려봐요! 아자아자!`
  if (agentId === "junho") return `${userName}군, 왔는가. 솔루션 항해사 준호다. 자, 어떤 고민이 그대의 앞길을 막고 있나?`
  return `안녕! 나는 베푸야 😊\n${userName}의 AI 베프!\n오늘도 무슨 일 있으면 다 말해줘!`
}

interface ChatWindowProps {
  userName?: string
  speechStyle?: "informal" | "formal" | "polite"
}

export default function ChatWindow({
  userName = "친구",
  speechStyle = "informal",
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [isSelectingAgent, setIsSelectingAgent] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isTtsSettingsOpen, setIsTtsSettingsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false) // 모바일 플로팅 모드용
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  // 화면 크기 트래킹
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isPresenceOpen, setIsPresenceOpen] = useState(false)
  const [agentPresence, setAgentPresence] = useState<Record<string, PresenceStatus>>({
    david: "attend",
    sarah: "attend",
    liam: "attend",
    chloe: "attend",
    minji: "attend",
    junho: "attend",
  })
  const [ttsVoice, setTtsVoice] = useState<string>("")
  const [ttsRate, setTtsRate] = useState<number>(1.0)
  const [language, setLanguage] = useState<string>("ko") // 추가: 선택 언어 state
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [isDebugOpen, setIsDebugOpen] = useState(false)
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([])
  const [activeDebugModel, setActiveDebugModel] = useState<string>("")
  const [lastResponseTime, setLastResponseTime] = useState<number>(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111"
  const STORAGE_KEY = `BEPU_CHAT_HISTORY_${CONVERSATION_ID}`
  // 빈 문자열이면 이 사이트엔 백엔드가 없다는 뜻 — 히스토리는 localStorage 캐시로만 채운다.
  const API_BASE_URL = apiHost()

  const addDebugLog = (level: "info" | "warn" | "error", category: string, message: string, data?: any) => {
    const newLog: DebugLog = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data
    }
    setDebugLogs(prev => [...prev.slice(-99), newLog]) // 최대 100개 유지
  }

  // 로컬 스토리지에서 설정 로드 및 가용 목소리 초기화
  useEffect(() => {
    const savedAgent = localStorage.getItem("BEPU_SELECTED_AGENT")
    if (savedAgent) setSelectedAgentId(savedAgent)
    else setIsSelectingAgent(true)

    const savedMute = localStorage.getItem("BEPU_IS_MUTED")
    if (savedMute === "true") setIsMuted(true)

    const savedVoice = localStorage.getItem("BEPU_TTS_VOICE")
    if (savedVoice) setTtsVoice(savedVoice)

    const savedRate = localStorage.getItem("BEPU_TTS_RATE")
    if (savedRate) setTtsRate(parseFloat(savedRate))

    const savedLang = localStorage.getItem("BEPU_LANGUAGE")
    if (savedLang) setLanguage(savedLang)

    // 브라우저 가용 목소리 로드
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      const currentLang = localStorage.getItem("BEPU_LANGUAGE") || "ko"

      const langFilterMap: Record<string, string> = {
        "ko": "ko",
        "en": "en",
        "ja": "ja",
        "zh": "zh",
        "vi": "vi"
      }

      const targetLang = langFilterMap[currentLang] || "ko"
      const filteredVoices = voices.filter(v => v.lang.toLowerCase().includes(targetLang))
      setAvailableVoices(filteredVoices)

      // 목소리 자동 매칭 (선택된 언어의 Google 보이스 우선)
      const savedVoice = localStorage.getItem("BEPU_TTS_VOICE")
      const bestVoice = filteredVoices.find(v => v.name.includes("Google") && v.lang.includes(targetLang)) || filteredVoices[0]

      if (!savedVoice && bestVoice) {
        setTtsVoice(bestVoice.name)
      } else if (savedVoice && !filteredVoices.find(v => v.name === savedVoice)) {
        // 저장된 목소리가 현재 언어와 맞지 않으면 변경
        if (bestVoice) setTtsVoice(bestVoice.name)
      }
    }

    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices

    // 브라우저 자동 재생 정책 해결을 위한 Priming 로직
    const primeAudio = () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance("")
        u.volume = 0
        window.speechSynthesis.speak(u)
        window.removeEventListener("click", primeAudio)
      }
    }
    window.addEventListener("click", primeAudio)
    return () => window.removeEventListener("click", primeAudio)
  }, [])

  // 무음 모드 변경 시 저장
  const toggleMute = () => {
    const newState = !isMuted
    setIsMuted(newState)
    localStorage.setItem("BEPU_IS_MUTED", String(newState))
  }

  // TTS 설정 변경 시 저장
  const updateTtsSetting = (voiceName: string, rate: number) => {
    setTtsVoice(voiceName)
    setTtsRate(rate)
    localStorage.setItem("BEPU_TTS_VOICE", voiceName)
    localStorage.setItem("BEPU_TTS_RATE", String(rate))
  }

  // 언어 변경 함수
  const changeLanguage = (newLang: string) => {
    setLanguage(newLang)
    localStorage.setItem("BEPU_LANGUAGE", newLang)
    // 목소리 목록 새로고침 유도
    window.speechSynthesis.dispatchEvent(new Event('voiceschanged'))
  }

  const selectedAgent = AGENTS.find(a => a.id === selectedAgentId) || AGENTS[0]

  useEffect(() => {
    // 채팅 내역 불러오기
    async function loadHistory() {
      try {
        const cache = localStorage.getItem(STORAGE_KEY)
        if (cache) {
          const cachedMessages = JSON.parse(cache)
          if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
            setMessages(cachedMessages)
          }
        }

        // 백엔드가 없는 배포에서는 아예 요청하지 않는다. 예전에는 방문자 브라우저가
        // 자기 컴퓨터의 localhost:8000 을 두드리다 실패했다.
        const res = API_BASE_URL
          ? await fetch(`${API_BASE_URL}/api/v1/chat/${CONVERSATION_ID}`)
          : null
        if (res?.ok) {
          const data = await res.json()
          if (data.messages && data.messages.length > 0) {
            // DB 형식(dict)을 프론트엔드 Message 타입으로 변환
            const loadedMessages = data.messages.map((m: any) => ({
              id: m.id || uuidv4(),
              conversation_id: CONVERSATION_ID,
              user_id: "test",
              role: m.role,
              content: m.content,
              attachments: [],
              detected_emotion: m.detected_emotion || "neutral",
              emotion_confidence: 1.0,
              created_at: new Date().toISOString()
            }))

            // 첫 인사말 자동 생성 로직
            const greeting = getAgentGreeting(selectedAgentId || localStorage.getItem("BEPU_SELECTED_AGENT") || "david", userName);

            setMessages([
              {
                id: uuidv4(),
                conversation_id: CONVERSATION_ID,
                user_id: "test",
                role: "assistant",
                content: greeting,
                attachments: [],
                detected_emotion: "happy",
                emotion_confidence: 1.0,
                created_at: new Date().toISOString(),
              },
              ...loadedMessages
            ])
            return
          }
        }
      } catch (err) {
        console.error("이전 대화 불러오기 실패:", err)
      }

      // 내역이 없거나 에러 시 기본 인사말만 설정
      setMessages([
        {
          id: uuidv4(),
          conversation_id: CONVERSATION_ID,
          user_id: "test",
          role: "assistant",
          content: getAgentGreeting(selectedAgentId || "david", userName),
          attachments: [],
          detected_emotion: "happy",
          emotion_confidence: 1.0,
          created_at: new Date().toISOString(),
        },
      ])
    }

    loadHistory()
  }, [userName])

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    }
  }, [messages, STORAGE_KEY])

  useEffect(() => {
    // 스트리밍 중에는 매끄러운 스크롤보다 즉각적인 스크롤(auto)이 성능에 유리함
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth" })
  }, [messages, isStreaming])

  const handleStopStreaming = () => {
    if (!isStreaming) return

    addDebugLog("warn", "API", "스트리밍 중단 요청")
    if (abortController) {
      abortController.abort()
      setAbortController(null)
    }
    setIsStreaming(false)

    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === "assistant" && last?.content === "") {
        return [...prev.slice(0, -1), { ...last, content: "생성 중단됨. 다시 시도해 주세요." }]
      }
      return prev
    })
  }

  const handleQuickSelectAgent = (agentId: string) => {
    if (agentPresence[agentId] === "absent") {
      alert("현재 이 페르소나는 부재 중이에요. (쿼터 초과) 😢")
      return
    }

    setSelectedAgentId(agentId)
    localStorage.setItem("BEPU_SELECTED_AGENT", agentId)

    // 선택된 캐릭터의 인사말 추가
    const greeting = getAgentGreeting(agentId, userName)
    const newMsg: Message = {
      id: uuidv4(),
      conversation_id: CONVERSATION_ID,
      user_id: "test",
      role: "assistant",
      content: greeting,
      attachments: [],
      detected_emotion: "happy",
      emotion_confidence: 1.0,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, newMsg])
  }

  async function handleSend(text: string) {
    const startTime = Date.now()
    addDebugLog("info", "API", "메시지 전송 시작", { text })

    // 브라우저 오디오 보안 정책 해제 (User Gesture 시점에 호출 필요)
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel() // 기존 음성 중지
      const prime = new SpeechSynthesisUtterance("")
      prime.volume = 0
      window.speechSynthesis.speak(prime)
    }
    addDebugLog("info", "CHAT", "메시지 전송 시작", { text: text.substring(0, 20) + "..." })

    let assistantMsgId = ""

    try {
      // 1. 유저 메시지 즉시 반영
      const userMsg: Message = {
        id: uuidv4(),
        conversation_id: CONVERSATION_ID,
        user_id: "user_debug",
        role: "user",
        content: text,
        attachments: [],
        detected_emotion: "neutral",
        emotion_confidence: 1.0,
        created_at: new Date().toISOString(),
      }

      assistantMsgId = uuidv4()
      const assistantMsg: Message = {
        id: assistantMsgId,
        conversation_id: CONVERSATION_ID,
        user_id: "bepu_ai",
        role: "assistant",
        content: "",
        attachments: [],
        detected_emotion: "neutral",
        emotion_confidence: 1.0,
        created_at: new Date().toISOString(),
      }

      const nextMessages = [...messages, userMsg]
      setMessages([...nextMessages, assistantMsg])
      const controller = new AbortController()
      setAbortController(controller)
      setIsStreaming(true)

      addDebugLog("info", "API", "백엔드 스트리밍 요청 시도")

      // 2. Gemini API 직접 호출 (백엔드 403 오류 우회)
      addDebugLog("info", "API", "Gemini 직접 호출 시도")
      
      const prompt = userMsg.content;
      const history: GeminiMessage[] = nextMessages.slice(0, -1).map(m => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }]
      }));

      const startTime = Date.now();
      let fullResponse = "";

      try {
        for await (const chunk of askGeminiStream(prompt, history)) {
          fullResponse += chunk;
          
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            // 메시지가 존재하고 assistant 메시지인 경우 업데이트
            if (lastMsg && lastMsg.id === assistantMsg.id) {
               // 중복 방지: 이미 내용이 같으면 업데이트 안함 (Gemini chunk가 중복될 수 있음)
               if (lastMsg.content === fullResponse) return prev;
               
               return [
                 ...prev.slice(0, -1),
                 { ...lastMsg, content: fullResponse }
               ];
            }
            return prev;
          });
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        setLastResponseTime(duration);
        addDebugLog("info", "API", "Gemini 스트림 완료", { duration: `${duration}ms` });

      } catch (error) {
        console.error("Gemini Error:", error);
        addDebugLog("error", "API", "Gemini 호출 실패", { error });
        
        setMessages((prev) => {
           const lastMsg = prev[prev.length - 1];
           if (lastMsg && lastMsg.id === assistantMsg.id) {
             return [
               ...prev.slice(0, -1),
               { ...lastMsg, content: "죄송해요, 지금은 대화하기 어려워요. (Gemini API Error)" }
             ];
           }
           return prev;
        });
      } finally {
        setIsStreaming(false);
        setAbortController(null);
      }
      
      /* 
      // 기존 백엔드 호출 로직 (주석 처리됨)
      const savedKeys = localStorage.getItem("user_ai_keys")
      // ... (Rest of original logic omitted for brevity)
      */
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        addDebugLog("warn", "API", "스트리밍 중단됨 (AbortError)")
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: "생성 중단됨. 다시 시도해 주세요." }
              : m
          )
        )
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: "앗, 뭔가 문제가 생겼어 😅 잠깐만 다시 해줘!" }
              : m
          )
        )
        addDebugLog("error", "SYSTEM", "handleSend 예외 발생", { error: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      setIsStreaming(false)
      setAbortController(null)
    }
  }

  return (
    <div className="flex flex-col h-full bg-bepu-bg relative">
      {/* 캐릭터 선택 온보딩 */}
      {isSelectingAgent && (
        <AgentSelector
          onSelect={(id) => {
            setSelectedAgentId(id)
            localStorage.setItem("BEPU_SELECTED_AGENT", id)
            setIsSelectingAgent(false)
          }}
        />
      )}

      {/* 헤더 (Top Bar) */}
      <header className="flex items-center justify-between px-5 py-4 bg-white/80 backdrop-blur-xl border-b border-bepu-blue/20 z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-full overflow-hidden border-2 border-bepu-blue/30 bg-gray-50">
            <img
              src={selectedAgent.avatar}
              alt={selectedAgent.name}
              className="w-full h-full object-cover scale-[2.5]"
              style={{ objectPosition: selectedAgent.position }}
            />
          </div>
          <div className="flex flex-col">
            <h1 className="text-[17px] font-bold text-bepu-text tracking-tight flex items-center gap-1.5">
              {selectedAgent.name}
              <span className="w-1.5 h-1.5 rounded-full bg-bepu-mint origin-center animate-pulse" />
            </h1>
            <p className="text-[12px] font-medium text-gray-400 -mt-0.5">{selectedAgent.role}</p>
          </div>
        </div>

        {/* 우측 아이콘 메뉴 */}
        <div className="flex items-center gap-2">
          {/* 캐릭터 퀵 셀렉터 (Flexible: 모바일 대응) */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/40 backdrop-blur-sm rounded-full border border-white/50 shadow-sm overflow-x-auto no-scrollbar max-w-[120px] xs:max-w-[180px] sm:max-w-[240px]">
            {AGENTS.map((agent) => {
              const isAbsent = agentPresence[agent.id] === "absent"
              const isSelected = selectedAgentId === agent.id
              return (
                <button
                  key={agent.id}
                  onClick={() => handleQuickSelectAgent(agent.id)}
                  disabled={isStreaming}
                  className={`relative w-7 h-7 rounded-full overflow-hidden transition-all duration-300 border shadow-sm shrink-0
                    ${isSelected ? "border-bepu-blue ring-2 ring-bepu-blue/20 scale-110 z-10" : "border-white hover:border-bepu-blue/30"}
                    ${isAbsent ? "opacity-30 grayscale cursor-not-allowed" : "hover:scale-110 active:scale-95"}
                  `}
                  title={isAbsent ? `${agent.name} (부재 중)` : `${agent.name}와 대화하기`}
                >
                  <img
                    src={agent.avatar}
                    alt={agent.name}
                    className="w-full h-full object-cover scale-[4]"
                    style={{ objectPosition: agent.position }}
                  />
                  {!isAbsent && (
                    <div className="absolute bottom-0 right-0 w-1.5 h-1.5 bg-green-500 border border-white rounded-full" />
                  )}
                </button>
              )
            })}
          </div>

          {isStreaming && (
            <button
              onClick={handleStopStreaming}
              className="px-3 py-1.5 rounded-full bg-red-500 text-white text-[12px] font-bold hover:bg-red-600 transition"
              title="길게 누르지 않아도 여기 클릭하면 중단됩니다"
            >
              중단
            </button>
          )}

          {/* 시스템 도구 그룹 (TTS, Mute, Lang) */}
          <div className="flex items-center bg-gray-50/50 backdrop-blur-sm p-1 rounded-full border border-gray-100 shadow-sm gap-1">
            {/* 언어 선택 드롭다운 (Flexible 전환) */}
            <div className="relative group">
              <select
                value={language}
                onChange={(e) => changeLanguage(e.target.value)}
                className="appearance-none bg-white/60 backdrop-blur-sm border border-white/50 rounded-full px-3 py-1 pr-6 text-[10px] font-bold text-bepu-blue shadow-sm outline-none focus:ring-1 focus:ring-bepu-blue/30 cursor-pointer transition-all hover:bg-white"
              >
                <option value="ko">KR 🇰🇷</option>
                <option value="en">US 🇺🇸</option>
                <option value="ja">JP 🇯🇵</option>
                <option value="zh">CN 🇨🇳</option>
                <option value="vi">VN 🇻🇳</option>
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-bepu-blue/50">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
            <div className="w-[1px] h-3 bg-gray-200 mx-1" />
            {/* Debug & Alerts */}
            <div className="flex items-center gap-1 ml-1 border-l border-white/10 pl-2">
              <button
                onClick={() => setIsDebugOpen(true)}
                className={`p-1.5 rounded-lg transition-all active:scale-95 ${debugLogs.some(l => l.level === 'error')
                  ? 'bg-red-500/20 text-red-400 animate-pulse'
                  : debugLogs.some(l => l.level === 'warn')
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                  }`}
                title="System Monitor"
              >
                <span className="text-xs font-bold leading-none">DEBUG</span>
              </button>
            </div>
            <button
              onClick={() => setIsTtsSettingsOpen(!isTtsSettingsOpen)}
              className={`p-1 rounded-full transition-colors ${isTtsSettingsOpen ? "text-bepu-blue bg-white" : "text-gray-400 hover:text-bepu-blue"}`}
              title="TTS 설정"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
            <button
              onClick={toggleMute}
              className={`p-1 rounded-full transition-colors ${isMuted ? "text-red-500 bg-red-50" : "text-gray-400 hover:text-bepu-blue"}`}
              title="무음 토글"
            >
              {isMuted ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 2l20 20M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
              )}
            </button>
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1 text-gray-400 hover:text-bepu-blue transition-colors sm:hidden"
              title="최소화"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5" /></svg>
            </button>
          </div>

          {/* 유틸리티 도구 그룹 (Presence, Debug, Settings) */}
          <div className="flex items-center gap-1 ml-1 shrink-0">
            <button
              onClick={() => setIsPresenceOpen(true)}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-green-500 hover:text-white transition-all text-xs border border-zinc-200"
              title="출석 관리"
            >
              🏠
            </button>
            <button
              onClick={() => setIsDebugOpen(!isDebugOpen)}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-all border
                ${isDebugOpen ? "bg-zinc-800 text-white border-zinc-800" : "bg-orange-50 text-orange-400 border-orange-100 hover:bg-orange-100"}`}
              title="디버그 패널"
            >
              🔍
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-blue-50 text-bepu-blue border border-blue-100 hover:bg-blue-100 transition-all text-xs"
              title="전체 설정"
            >
              ⚙️
            </button>
          </div>
        </div>
      </header>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* TTS 유틸리티 바 (상시 노출) */}
      <div className="flex items-center gap-4 px-5 py-2 bg-zinc-50/80 backdrop-blur-md border-b border-zinc-100 z-10 shrink-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Voice</span>
          <select
            value={ttsVoice}
            onChange={(e) => updateTtsSetting(e.target.value, ttsRate)}
            className="bg-white border border-zinc-200 rounded-lg px-2 py-1 text-[11px] font-bold text-zinc-700 outline-none focus:ring-1 focus:ring-bepu-blue/30"
          >
            {availableVoices.map(v => (
              <option key={v.name} value={v.name}>{v.name.includes("Google") ? "🌟 " : ""}{v.name.split(" ")[0]}</option>
            ))}
          </select>
        </div>
        <div className="h-3 w-[1px] bg-zinc-200 shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-[120px]">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Speed</span>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={ttsRate}
            onChange={(e) => updateTtsSetting(ttsVoice, parseFloat(e.target.value))}
            className="flex-1 accent-bepu-blue h-1.5"
          />
          <span className="text-[10px] font-mono font-bold text-bepu-blue bg-bepu-blue/5 px-1 rounded">{ttsRate.toFixed(1)}x</span>
        </div>
      </div>

      <AgentPresenceManager
        isOpen={isPresenceOpen}
        presence={agentPresence}
        onToggle={(id) => setAgentPresence(prev => ({ ...prev, [id]: prev[id] === "attend" ? "absent" : "attend" }))}
        onClose={() => setIsPresenceOpen(false)}
      />

      <DebugPanel
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        logs={debugLogs}
        activeModel={activeDebugModel}
        lastResponseTime={lastResponseTime}
        presenceStatus={agentPresence}
      />

      {/* TTS 상세 설정 팝업 */}
      {
        isTtsSettingsOpen && (
          <div className="absolute top-[80px] right-24 w-64 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-bepu-blue/10 p-5 z-40 animate-in fade-in zoom-in duration-200">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="text-[14px] font-bold text-bepu-text">목소리 및 속도</h3>
                <button onClick={() => setIsTtsSettingsOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-bold text-gray-500">목소리 선택 (Google 음성 권장)</label>
                <select
                  value={ttsVoice}
                  onChange={(e) => updateTtsSetting(e.target.value, ttsRate)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-[13px] outline-none focus:ring-1 focus:ring-bepu-blue/50 transition-all font-medium"
                >
                  {availableVoices.length > 0 ? (
                    availableVoices
                      .sort((a, b) => {
                        // Google 음성을 최상단으로
                        const aIsGoogle = a.name.includes("Google")
                        const bIsGoogle = b.name.includes("Google")
                        if (aIsGoogle && !bIsGoogle) return -1
                        if (!aIsGoogle && bIsGoogle) return 1
                        return 0
                      })
                      .map(voice => (
                        <option key={voice.name} value={voice.name}>
                          {voice.name.includes("Google") ? "🌟 " : ""}{voice.name}
                        </option>
                      ))
                  ) : (
                    <option disabled>사용 가능한 한국어 음성 없음</option>
                  )}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-bold text-gray-500">말하기 속도</label>
                  <span className="text-[11px] font-mono text-bepu-blue font-bold bg-bepu-blue/10 px-1.5 rounded">{ttsRate.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={ttsRate}
                  onChange={(e) => updateTtsSetting(ttsVoice, parseFloat(e.target.value))}
                  className="w-full accent-bepu-blue cursor-pointer"
                />
                <div className="flex justify-between px-1 text-[10px] text-gray-400 font-medium">
                  <span>느림</span>
                  <span>보통</span>
                  <span>빠름</span>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* 그라데이션 오버레이 (위/아래 부드러운 전환) */}
      <div className="absolute top-[73px] left-0 right-0 h-6 bg-gradient-to-b from-bepu-bg to-transparent z-10 pointer-events-none" />

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-5 py-6" onClick={() => { if (isStreaming) handleStopStreaming() }}>
        <div className="flex flex-col min-h-full justify-end">
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && i === messages.length - 1}
              agentId={selectedAgentId || "david"}
              isMuted={isMuted}
              isLastMessage={i === messages.length - 1}
              ttsVoice={ttsVoice}
              ttsRate={ttsRate}
              language={language} // 언어 정보 전달
            />
          ))}
          <div ref={bottomRef} className="h-2" />
        </div>
      </div>

      {/* 입력 영역 */}
      <div className="px-5 py-4 pb-6 bg-gradient-to-t from-bepu-bg via-bepu-bg to-transparent shrink-0">
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>

      {/* 모바일 플로팅 챗봇맨 아바타 */}
      {(isMinimized || windowWidth < 640) && (
        <div
          className={`fixed bottom-6 right-6 z-[100] transition-all duration-500 transform 
            ${isMinimized ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"}
          `}
        >
          <button
            onClick={() => setIsMinimized(false)}
            className="group relative w-16 h-16 rounded-full bg-white shadow-2xl border-2 border-bepu-blue/30 overflow-hidden hover:scale-110 active:scale-95 transition-all outline-none animate-bounce-slow"
          >
            <img
              src={selectedAgent.avatar}
              alt="챗봇맨"
              className="w-full h-full object-cover scale-[3.5] group-hover:scale-[4] transition-transform"
              style={{ objectPosition: selectedAgent.position }}
            />
            {/* 알림 배지 */}
            {isStreaming && (
              <div className="absolute top-1 right-1 w-4 h-4 bg-bepu-mint rounded-full border-2 border-white animate-pulse" />
            )}
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white px-3 py-1 rounded-full text-[10px] font-bold text-bepu-blue shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-bepu-blue/10">
              안녕! 대화할까? 👋
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
