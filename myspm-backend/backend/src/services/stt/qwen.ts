import path from "node:path";
import fs from "node:fs/promises";
import type { SttLanguage } from "./types";
import { qwenLanguageHints, resolveQwenApiKey } from "./config";

type UguuUploadResponse = {
  files?: Array<{ url?: string }>;
};

type QwenTaskSubmitResponse = {
  output?: { task_id?: string };
};

type QwenTaskStatusResponse = {
  output?: {
    task_status?: string;
    result?: { transcription_url?: string };
  };
};

type QwenTranscriptResult = {
  transcripts?: Array<{ text?: string }>;
};

export async function qwenTranscribe(filePath: string, language: SttLanguage): Promise<string> {
  const apiKey = resolveQwenApiKey();
  if (!apiKey) {
    throw new Error("Qwen STT is not configured (QWEN_API_KEY or QWEN_GRADING_API_KEY)");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const fileBytes = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".mp3" || ext === ".mpeg"
      ? "audio/mpeg"
      : ext === ".webm"
        ? "audio/webm"
        : ext === ".m4a" || ext === ".mp4"
          ? "audio/mp4"
          : "audio/wav";

  const form = new FormData();
  form.append(
    "files[]",
    new Blob([fileBytes], { type: mime }),
    path.basename(filePath),
  );

  const uploadRes = await fetch("https://uguu.se/upload", { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`uguu upload failed: ${uploadRes.status}`);
  }
  const uploadData = (await uploadRes.json()) as UguuUploadResponse;
  const fileUrl = uploadData?.files?.[0]?.url;
  if (!fileUrl) {
    throw new Error(`uguu upload failed: ${JSON.stringify(uploadData)}`);
  }

  const taskRes = await fetch(
    "https://dashscope-intl.aliyuncs.com/api/v1/services/audio/asr/transcription",
    {
      method: "POST",
      headers: { ...headers, "X-DashScope-Async": "enable" },
      body: JSON.stringify({
        model: "qwen3-asr-flash-filetrans",
        input: { file_url: fileUrl },
        parameters: { language_hints: qwenLanguageHints(language) },
      }),
    },
  );
  const taskData = (await taskRes.json()) as QwenTaskSubmitResponse;
  const taskId = taskData.output?.task_id;
  if (!taskId) {
    throw new Error(`Qwen task submit failed: ${JSON.stringify(taskData)}`);
  }

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(
      `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
      { headers },
    );
    const status = (await statusRes.json()) as QwenTaskStatusResponse;
    const taskStatus = status.output?.task_status;

    if (taskStatus === "SUCCEEDED") {
      const url = status.output?.result?.transcription_url;
      if (!url) throw new Error("Qwen succeeded but missing transcription_url");
      const result = (await (await fetch(url)).json()) as QwenTranscriptResult;
      return (result.transcripts || []).map((t) => t.text ?? "").join("\n").trim();
    }
    if (taskStatus === "FAILED") {
      throw new Error(`Qwen task failed: ${JSON.stringify(status.output)}`);
    }
  }
  throw new Error("Qwen transcription timed out after 2 minutes");
}
