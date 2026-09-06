import { useState } from "react"
import { AGENTS, Agent } from "@/constants/agents"
import Image from "next/image"

interface AgentSelectorProps {
    onSelect: (agentId: string) => void
}

export default function AgentSelector({ onSelect }: AgentSelectorProps) {
    const [hoveredAgent, setHoveredAgent] = useState<string | null>(null)

    return (
        <div className="fixed inset-0 z-[100] bg-white/90 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-bepu-text overflow-y-auto">
            <div className="max-w-4xl w-full text-center space-y-2 mb-10 mt-20">
                <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-bepu-blue">
                    나만의 <span className="text-bepu-coral">베푸</span>를 선택해 주세요!
                </h1>
                <p className="text-gray-500 font-medium whitespace-pre-wrap">
                    사용자님의 일상을 함께할 6명의 특별한 파트너들이 기다리고 있어요.{"\n"}
                    언제든 메뉴에서 캐릭터를 변경할 수 있습니다.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl w-full pb-20">
                {AGENTS.map((agent) => (
                    <button
                        key={agent.id}
                        onClick={() => onSelect(agent.id)}
                        onMouseEnter={() => setHoveredAgent(agent.id)}
                        onMouseLeave={() => setHoveredAgent(null)}
                        className={`group relative flex flex-col items-center p-6 rounded-[32px] border-2 transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 text-left bg-white
              ${hoveredAgent === agent.id ? "border-bepu-blue ring-4 ring-bepu-blue/10" : "border-gray-100"}`}
                    >
                        {/* 프로필 이미지 영역 */}
                        <div className="relative w-32 h-32 mb-6 rounded-full overflow-hidden border-4 border-white shadow-lg group-hover:scale-105 transition-transform duration-500 bg-gray-100">
                            <img
                                src={agent.avatar}
                                alt={agent.name}
                                className="w-full h-full object-cover scale-[2.5]"
                                style={{ objectPosition: agent.position }}
                            />
                            <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors" />
                        </div>

                        {/* 정보 영역 */}
                        <div className="w-full space-y-1">
                            <div className="flex items-center justify-between">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500`}>
                                    {agent.mbti}
                                </span>
                                <span className="text-[11px] font-bold text-bepu-coral uppercase tracking-widest">{agent.specialty}</span>
                            </div>
                            <h3 className="text-xl font-black text-bepu-text">{agent.name}</h3>
                            <p className="text-sm font-bold text-bepu-blue mb-2">{agent.role}</p>
                            <p className="text-[13px] text-gray-400 font-medium leading-relaxed line-clamp-3">
                                {agent.description}
                            </p>
                        </div>

                        {/* 상태 뱃지 */}
                        <div className={`absolute top-4 right-4 w-3 h-3 rounded-full bg-bepu-mint shadow-[0_0_10px_rgba(45,212,191,0.5)] opacity-0 group-hover:opacity-100 transition-opacity`} />
                    </button>
                ))}
            </div>
        </div>
    )
}
