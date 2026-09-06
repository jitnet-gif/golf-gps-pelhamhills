import Anthropic from "@anthropic-ai/sdk"

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.")
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const BEPU_MODEL = "claude-sonnet-4-6"
export const MAX_TOKENS = 1024
