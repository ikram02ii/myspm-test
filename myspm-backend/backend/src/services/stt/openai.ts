import fs from "node:fs";
import { OpenAI } from "openai";
import { openAiApiKey, openAiModel } from "./config";

export async function openaiTranscribe(
  filePath: string,
  openaiLang: string,
  prompt: string,
): Promise<string> {
  const apiKey = openAiApiKey();
  if (!apiKey) {
    throw new Error("OpenAI is not configured (OPENAI_API_KEY)");
  }

  const openai = new OpenAI({ apiKey });
  const res = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: openAiModel(),
    language: openaiLang,
    prompt,
  });
  return (res.text || "").trim();
}
