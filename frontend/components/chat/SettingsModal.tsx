import React, { useState, useEffect } from "react"

interface AIKeyConfig {
    [model: string]: string[]
}

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
}

const AI_MODELS = [
    { id: "gemini", name: "Google Gemini", link: "https://aistudio.google.com/app/apikey", tip: "구글 계정 하나당 무상 쿼터가 넉넉합니다. 여러 계정을 등록해 보세요!" },
    { id: "claude", name: "Anthropic Claude", link: "https://console.anthropic.com/settings/keys", tip: "베푸의 메인 엔진입니다. 핵심 대화 품질을 책임집니다." },
    { id: "openai", name: "OpenAI GPT", link: "https://platform.openai.com/api-keys", tip: "강력한 폴백 엔진입니다. 지불 계정 연결이 필요할 수 있습니다." },
    { id: "perplexity", name: "Perplexity AI", link: "https://www.perplexity.ai/settings/api", tip: "실시간 정보 검색용 엔진으로 활용됩니다." },
    { id: "mistral", name: "Mistral AI", link: "https://console.mistral.ai/api-keys/", tip: "가성비 좋은 유럽산 오픈소스 기반 엔진입니다." },
    { id: "copilot", name: "MS Copilot/Azure", link: "https://github.com/settings/tokens", tip: "GitHub 계정으로 연동되는 강력한 인터페이스입니다." },
]

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [keys, setKeys] = useState<AIKeyConfig>({})
    const [activeTab, setActiveTab] = useState("gemini")

    useEffect(() => {
        // 로컬 스토리지에서 키 불러오기
        const savedKeys = localStorage.getItem("user_ai_keys")
        if (savedKeys) {
            setKeys(JSON.parse(savedKeys))
        }
    }, [isOpen])

    const handleSave = () => {
        localStorage.setItem("user_ai_keys", JSON.stringify(keys))
        alert("AI 키가 안전하게 저장되었습니다! 🚀")
        onClose()
    }

    const updateKey = (modelId: string, index: number, value: string) => {
        const newModelKeys = [...(keys[modelId] || ["", "", "", "", ""])]
        newModelKeys[index] = value
        setKeys({ ...keys, [modelId]: newModelKeys })
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white/90 dark:bg-zinc-900 w-full max-w-2xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-800/50">
                    <div>
                        <h2 className="text-xl font-bold text-zinc-800 dark:text-white flex items-center gap-2">
                            <span className="text-2xl">🛡️</span> AI API 키 관리 센터
                        </h2>
                        <p className="text-sm text-zinc-500 mt-1">모델당 최대 5개의 키를 저장하여 쿼터 이슈를 방지합니다.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full transition-colors">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar Tabs */}
                    <div className="w-48 border-r border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30 overflow-y-auto pt-4">
                        {AI_MODELS.map(model => (
                            <button
                                key={model.id}
                                onClick={() => setActiveTab(model.id)}
                                className={`w-full px-4 py-3 text-left text-sm font-bold transition-all flex items-center gap-2
                  ${activeTab === model.id
                                        ? "text-bepu-blue bg-bepu-blue/10 border-r-4 border-bepu-blue"
                                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                            >
                                {model.name}
                            </button>
                        ))}
                    </div>

                    {/* Key Fields Area */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        <div className="mb-6 flex justify-between items-start">
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-zinc-800 dark:text-white">
                                    {AI_MODELS.find(m => m.id === activeTab)?.name} 키 설정
                                </h3>
                                <p className="text-[11px] text-blue-500 font-bold mt-0.5">
                                    💡 {AI_MODELS.find(m => m.id === activeTab)?.tip}
                                </p>
                            </div>
                            <a
                                href={AI_MODELS.find(m => m.id === activeTab)?.link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-bepu-blue hover:underline font-bold flex items-center gap-1 shrink-0"
                            >
                                발급 페이지 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" /></svg>
                            </a>
                        </div>

                        <div className="space-y-4">
                            {[0, 1, 2, 3, 4].map(idx => (
                                <div key={idx} className="space-y-1">
                                    <label className="text-[11px] font-bold text-zinc-400 ml-1">Key #{idx + 1}</label>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            value={(keys[activeTab] || [])[idx] || ""}
                                            onChange={(e) => updateKey(activeTab, idx, e.target.value)}
                                            placeholder={`${idx === 0 ? "기본" : "예비 " + idx} API 키를 입력하세요`}
                                            className="w-full px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-none rounded-2xl text-sm focus:ring-2 focus:ring-bepu-blue transition-all"
                                        />
                                        <button
                                            onClick={() => {
                                                const val = (keys[activeTab] || [])[idx] || ""
                                                if (val) navigator.clipboard.writeText(val).then(() => alert("복사되었습니다!"))
                                            }}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-bepu-blue transition-colors"
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-8 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-100 dark:border-amber-900/30">
                            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed font-medium">
                                💡 **팁**: 첫 번째 키가 쿼터를 다 쓰면 순차적으로 다음 키를 사용합니다. 여러 계정을 등록해두면 중단 없는 대화가 가능해요!
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3 bg-zinc-50/50 dark:bg-zinc-800/50">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-full text-sm font-bold text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-8 py-2.5 rounded-full text-sm font-bold bg-bepu-blue text-white shadow-lg shadow-bepu-blue/20 hover:scale-[1.02] active:scale-95 transition-all"
                    >
                        설정 저장하기
                    </button>
                </div>
            </div>
        </div>
    )
}
