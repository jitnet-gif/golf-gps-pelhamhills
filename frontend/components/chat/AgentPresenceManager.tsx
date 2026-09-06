import React from "react"
import { AGENTS, Agent } from "@/constants/agents"

export type PresenceStatus = "attend" | "absent"

interface AgentPresenceManagerProps {
    presence: Record<string, PresenceStatus>
    onToggle: (agentId: string) => void
    isOpen: boolean
    onClose: () => void
}

const ENGINE_MAP: Record<string, string> = {
    liam: "Gemini",
    chloe: "Claude",
    david: "Groq",
    sarah: "Perplexity",
    minji: "Mistral",
    junho: "OpenAI",
}

export default function AgentPresenceManager({ presence, onToggle, isOpen, onClose }: AgentPresenceManagerProps) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-3xl shadow-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                <div className="p-6 border-b border-zinc-50 dark:border-zinc-800 flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-800/30">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-800 dark:text-white flex items-center gap-2">
                            <span className="text-xl">🎭</span> 페르소나 출석 관리
                        </h2>
                        <p className="text-[11px] text-zinc-500 font-medium">대화에 참여할 AI 베프들을 선택해 주세요.</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full transition-all">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
                    {AGENTS.map((agent) => {
                        const isAttend = presence[agent.id] === "attend"
                        const engine = ENGINE_MAP[agent.id] || "Unknown"

                        return (
                            <div
                                key={agent.id}
                                className={`flex items-center justify-between p-4 rounded-2xl border transition-all
                  ${isAttend
                                        ? "bg-white dark:bg-zinc-800 border-bepu-blue/20 shadow-sm"
                                        : "bg-zinc-50 dark:bg-zinc-900/50 border-zinc-100 dark:border-zinc-800 opacity-60"}
                `}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <div
                                            className="w-10 h-10 rounded-full bg-zinc-200 overflow-hidden border-2 border-white dark:border-zinc-700 shadow-sm transition-transform group-hover:scale-110"
                                            style={{
                                                backgroundImage: `url(${agent.avatar})`,
                                                backgroundSize: "600% 600%", // 그룹 이미지에서 각 캐릭터 위치
                                                backgroundPosition: agent.position,
                                            }}
                                        />
                                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800
                      ${isAttend ? "bg-green-500" : "bg-zinc-400"}`}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{agent.name}</span>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold uppercase tracking-tighter">
                                                {engine}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-zinc-500 font-medium">{agent.role}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <span className={`text-[11px] font-bold ${isAttend ? "text-green-600 dark:text-green-400" : "text-zinc-400"}`}>
                                        {isAttend ? "출석 중" : "부재 중"}
                                    </span>
                                    <button
                                        onClick={() => onToggle(agent.id)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none 
                      ${isAttend ? "bg-bepu-blue" : "bg-zinc-200 dark:bg-zinc-700"}`}
                                    >
                                        <span
                                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out
                        ${isAttend ? "translate-x-5" : "translate-x-0"}`}
                                        />
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>

                <div className="p-6 bg-zinc-50/50 dark:bg-zinc-800/30 border-t border-zinc-50 dark:border-zinc-800">
                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold shadow-xl shadow-zinc-900/10 hover:scale-[1.02] active:scale-95 transition-all"
                    >
                        확인 및 닫기
                    </button>
                </div>
            </div>
        </div>
    )
}
