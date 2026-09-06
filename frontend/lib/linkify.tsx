import React from "react"

/**
 * 텍스트 내의 URL과 전화번호를 감지하여 클릭 가능한 링크로 변환합니다.
 * 학생 여러분: 정규식(Regex)을 사용하면 텍스트 패턴을 쉽게 찾을 수 있습니다! 😊
 */
export function linkify(text: string) {
    if (!text) return text

    // 1. URL 감지 (http, https)
    // 2. 전화번호 감지 (010-1234-5678, 02-123-4567 등 다양한 형식)
    const combinedRegex = /(https?:\/\/[^\s]+)|(\d{2,3}-\d{3,4}-\d{4})|(\d{10,11})/g

    const parts = text.split(combinedRegex)
    const matches = text.match(combinedRegex)

    if (!matches) return text

    const result: (string | React.JSX.Element)[] = []
    let matchIndex = 0

    // split 결과는 [텍스트, 매칭1, 매칭2, 텍스트, ...] 순서임
    // 하지만 캡처 그룹이 여러개라 undefined가 섞일 수 있음
    // 여기서는 단순히 split과 match를 조합하여 처리

    const tokens = text.split(/(https?:\/\/[^\s]+|\d{2,3}-\d{3,4}-\d{4}|\d{10,11})/)

    return tokens.map((token, i) => {
        if (token.match(/^https?:\/\//)) {
            return (
                <a
                    key={i}
                    href={token}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline decoration-2 underline-offset-4 hover:text-white/80 transition-colors drop-shadow-sm font-bold"
                >
                    {token}
                </a>
            )
        }

        if (token.match(/^\d{2,3}-\d{3,4}-\d{4}$|^\d{10,11}$/)) {
            return (
                <a
                    key={i}
                    href={`tel:${token.replace(/-/g, "")}`}
                    className="text-white underline decoration-2 underline-offset-4 hover:text-white/80 transition-colors drop-shadow-sm font-bold"
                >
                    {token}
                </a>
            )
        }

        return token
    })
}
