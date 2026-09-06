// Google Gemini API Client (Streaming)
// 작성일: 2026-03-16 09:30

const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

export interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

/**
 * Gemini API를 사용하여 스트리밍 응답을 생성합니다.
 * @param prompt 사용자 입력 프롬프트
 * @param history 이전 대화 내역 (선택사항)
 */
export async function* askGeminiStream(
  prompt: string,
  history: GeminiMessage[] = []
): AsyncGenerator<string, void, unknown> {
  if (!GEMINI_API_KEY) {
    yield "Error: NEXT_PUBLIC_GEMINI_API_KEY is not set.";
    return;
  }

  const contents = [
    ...history,
    { role: "user", parts: [{ text: prompt }] },
  ];

  try {
    const response = await fetch(
      `${GEMINI_ENDPOINT}${GEMINI_MODEL}:streamGenerateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API Error: ${response.statusText}`);
    }

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // JSON 파싱 (스트림 청크 처리)
      // Gemini의 스트림 응답은 배열 형태로 오는데, `[{...}, {...}]` 형식이 아닐 수도 있음.
      // 보통 `data: ` 형식이 아니라 JSON 객체가 연속됨.
      // 하지만 `streamGenerateContent`는 JSON 배열의 원소를 하나씩 보내는게 아니라, 
      // `[{ "candidates": [...] }]` 형태의 JSON 객체가 옴.
      // 여기서는 간단히 정규식이나 JSON 파서로 처리해야 함.
      
      // 임시: 전체 버퍼를 파싱 시도하거나, `}\n{` 같은 경계를 찾아서 분리.
      // Gemini API는 `[`로 시작하고 `]`로 끝나는 JSON 배열을 보냄.
      // 중간에 `,`로 구분됨.
      
      // 간단한 파싱 로직 (완벽하지 않을 수 있음)
      while (buffer.includes('"text": "')) {
          const match = buffer.match(/"text": "(.*?)"/);
          if (match) {
             const text = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
             yield text;
             buffer = buffer.substring(match.index! + match[0].length);
          } else {
              break;
          }
      }
    }
  } catch (error) {
    console.error("Gemini Streaming Error:", error);
    yield "Error communicating with Gemini.";
  }
}

/**
 * 단순 텍스트 응답 (Non-streaming)
 */
export async function askGemini(prompt: string) {
    if (!GEMINI_API_KEY) return "Gemini API 키가 설정되지 않았습니다."
  
    try {
      const response = await fetch(`${GEMINI_ENDPOINT}${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      })
  
      const data = await response.json()
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini로부터 답변을 받지 못했습니다."
    } catch (error) {
      console.error("Gemini 호출 중 오류 발생:", error)
      return "Gemini AI와 통신하는 중 오류가 발생했습니다."
    }
  }
