import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
const MODEL_NAME = "gemini-2.0-flash"; // Or whatever model you prefer

export async function askGeminiStream(
  prompt: string, 
  history: { role: "user" | "model"; parts: { text: string }[] }[] = []
) {
  if (!API_KEY) {
    throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const chat = model.startChat({
    history: history,
    generationConfig: {
      maxOutputTokens: 1000,
    },
  });

  const result = await chat.sendMessageStream(prompt);
  return result.stream;
}
