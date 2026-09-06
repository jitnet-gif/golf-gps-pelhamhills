import React, { useState, useEffect } from "react"

export interface DebugLog {
    id: string
    timestamp: string
    level: "info" | "warn" | "error"
    category: string
    message: string
    data?: any
}

interface DebugPanelProps {
    isOpen: boolean
    onClose: () => void
    logs: DebugLog[]
    activeModel?: string
    lastResponseTime?: number
    presenceStatus: Record<string, string>
}

export default function DebugPanel({ isOpen, onClose, logs, activeModel, lastResponseTime, presenceStatus }: DebugPanelProps) {
    const [filter, setFilter] = useState<string>("all")

    if (!isOpen) return null

    const filteredLogs = logs.filter(log => {
        if (filter === "all") return true
        if (filter === "warn") return log.level === "warn"
        return log.level === filter
    })

    const hasError = logs.some(l => l.level === "error")
    const hasWarn = logs.some(l => l.level === "warn")

    return (
        <div className="fixed bottom-20 right-6 w-[400px] h-[500px] bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-[200] flex flex-col overflow-hidden text-zinc-300 font-mono text-[11px] animate-in slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className={`p-4 border-b border-white/5 flex items-center justify-between transition-colors
                ${hasError ? "bg-red-500/10" : hasWarn ? "bg-yellow-500/10" : "bg-white/5"}`}>
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${hasError ? 'bg-red-500 animate-ping' : hasWarn ? 'bg-yellow-500 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
                    <h3 className="font-bold text-white uppercase tracking-wider">System Monitor</h3>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
            </div>

            {/* Quick Stats */}
            <div className="p-4 grid grid-cols-2 gap-2 bg-black/20">
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                    <p className="text-[9px] text-zinc-500 uppercase font-bold">Active Engine</p>
                    <p className="text-blue-400 font-bold truncate">{activeModel || "N/A"}</p>
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                    <p className="text-[9px] text-zinc-500 uppercase font-bold">Latency</p>
                    <p className="text-orange-400 font-bold">{lastResponseTime ? `${lastResponseTime}ms` : "---"}</p>
                </div>
            </div>

            {/* Presence Summary */}
            <div className="px-4 py-2 flex flex-wrap gap-1.5 border-b border-white/5">
                {Object.entries(presenceStatus).map(([id, status]) => (
                    <div key={id} className={`px-1.5 py-0.5 rounded border text-[9px] ${status === 'attend' ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-red-500/30 text-red-400 bg-red-500/5'}`}>
                        {id.toUpperCase()}: {status}
                    </div>
                ))}
            </div>

            {/* Log Controls */}
            <div className="px-4 py-2 flex items-center gap-2 border-b border-white/5 bg-white/5 overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setFilter("all")}
                    className={`px-2 py-0.5 rounded shrink-0 ${filter === 'all' ? 'bg-white/20 text-white' : 'hover:text-white'}`}
                >
                    ALL
                </button>
                <button
                    onClick={() => setFilter("error")}
                    className={`px-2 py-0.5 rounded shrink-0 ${filter === 'error' ? 'bg-red-500/40 text-white' : 'hover:text-red-400'}`}
                >
                    ERRORS {hasError && "🚨"}
                </button>
                <button
                    onClick={() => setFilter("warn")}
                    className={`px-2 py-0.5 rounded shrink-0 ${filter === 'warn' ? 'bg-yellow-500/40 text-white' : 'hover:text-yellow-400'}`}
                >
                    WARNS {hasWarn && "⚠️"}
                </button>
                <button
                    onClick={() => setFilter("info")}
                    className={`px-2 py-0.5 rounded shrink-0 ${filter === 'info' ? 'bg-blue-500/40 text-white' : 'hover:text-blue-400'}`}
                >
                    INFO
                </button>
            </div>

            {/* Log List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
                {filteredLogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-2">
                        <span className="text-3xl">📡</span>
                        <p>No matches found...</p>
                    </div>
                ) : (
                    filteredLogs.slice().reverse().map(log => (
                        <div key={log.id} className="group border-l-2 border-white/10 pl-2 py-0.5 hover:bg-white/5 transition-colors">
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[9px] font-bold px-1 rounded ${log.level === 'error' ? 'bg-red-500/20 text-red-400' :
                                    log.level === 'warn' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                                    }`}>
                                    {log.level.toUpperCase()}
                                </span>
                                <span className="text-[9px] text-zinc-500">{log.timestamp.split('T')[1].split('.')[0]}</span>
                                <span className="text-zinc-400 font-bold">[{log.category}]</span>
                            </div>
                            <p className="leading-relaxed text-zinc-300 break-all">{log.message}</p>
                            {log.data && (
                                <details className="mt-1">
                                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-400 transition-colors">View Data</summary>
                                    <pre className="mt-1 p-2 bg-black/40 rounded text-[9px] overflow-x-auto text-zinc-400">
                                        {JSON.stringify(log.data, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
