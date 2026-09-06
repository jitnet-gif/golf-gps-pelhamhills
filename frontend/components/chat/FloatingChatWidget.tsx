"use client"

import { useState } from "react"
import ChatWindow from "./ChatWindow"

export default function FloatingChatWidget() {
  const [isOpen, setIsOpen] = useState(false)

  const toggleChat = () => setIsOpen(!isOpen)

  return (
    <>
      {/* 모바일: 오버레이 + 중앙 모달, 데스크톱: 고정 오른쪽 위젯 */}
      <div className="fixed inset-0 z-40 pointer-events-none sm:pointer-events-none">
        {isOpen && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm sm:hidden" onClick={() => setIsOpen(false)} />
        )}
      </div>

      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 sm:items-end">
        <div
          className={`transition-all duration-300 ease-in-out transform origin-bottom-right
            ${isOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4 pointer-events-none"}
            fixed bottom-16 right-3 sm:right-6
            ${isOpen ? "w-[94vw] max-w-[640px] h-[78vh] sm:w-[420px] sm:h-[620px]" : "w-0 h-0"}
            bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-200 z-50
          `}
        >
          <div className="h-full flex flex-col">
            <div className="flex justify-between items-center px-4 py-2 bg-gradient-to-r from-bepu-mint to-blue-500 text-white">
              <div>
                <div className="text-sm font-bold tracking-wide">BEPU 채팅 위젯</div>
                <div className="text-[11px] opacity-90">모바일/데스크톱 모두 빠른 지원</div>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1 rounded-md bg-white/20 hover:bg-white/30">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatWindow userName="준호" />
            </div>
          </div>
        </div>

        <button
          onClick={toggleChat}
          className={`flex items-center justify-center w-14 h-14 rounded-full shadow-xl transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-bepu-mint/40 ${isOpen ? "bg-gray-800 text-white rotate-45" : "bg-gradient-to-r from-bepu-mint to-blue-500 text-white hover:scale-105"}`}
          aria-label={isOpen ? "채팅 닫기" : "채팅 열기"}
        >
          {isOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          )}
        </button>
      </div>
    </>
  )
}
