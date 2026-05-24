export type SpeakingTranscribeResult = {
  transcript: string;
  model: string;
  language: string;
};

function sttModel(): string {
  return process.env.STT_MODEL?.trim() || "qwen";
}

function sttLanguage(): string {
  return process.env.STT_LANGUAGE?.trim() || "en-MY";
}

function qwenLanguageHints(language: string): string[] {
  const lang = language.trim().toLowerCase();
  if (lang === "en-my" || lang.startsWith("en")) return ["en"];
  if (lang === "mixed") return ["en", "ms"];
  return ["ms"];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Qwen DashScope file transcription (same logic as stt-api, runs in-process). */
async function qwenTranscribeFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  language: string,
): Promise<string> {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set QWEN_API_KEY in backend/.env for English speaking transcription.");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const uploadForm = new FormData();
  uploadForm.append(
    "files[]",
    new Blob([buffer], { type: mimeType || "audio/m4a" }),
    fileName,
  );

  const uploadRes = await fetch("https://uguu.se/upload", { method: "POST", body: uploadForm });
  if (!uploadRes.ok) {
    throw new Error(`Audio upload for transcription failed (${uploadRes.status})`);
  }

  const uploadData = (await uploadRes.json()) as { files?: Array<{ url?: string }> };
  const fileUrl = uploadData?.files?.[0]?.url;
  if (!fileUrl) {
    throw new Error("Audio upload for transcription returned no file URL.");
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

  const taskData = (await taskRes.json()) as { output?: { task_id?: string }; message?: string };
  const taskId = taskData.output?.task_id;
  if (!taskId) {
    throw new Error(
      `Qwen transcription task failed: ${taskData.message ?? JSON.stringify(taskData).slice(0, 200)}`,
    );
  }

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const statusRes = await fetch(
      `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
      { headers },
    );
    const status = (await statusRes.json()) as {
      output?: {
        task_status?: string;
        result?: { transcription_url?: string };
        message?: string;
      };
    };
    const taskStatus = status.output?.task_status;

    if (taskStatus === "SUCCEEDED") {
      const resultUrl = status.output?.result?.transcription_url;
      if (!resultUrl) throw new Error("Qwen transcription succeeded but no result URL.");
      const result = (await (await fetch(resultUrl)).json()) as {
        transcripts?: Array<{ text?: string }>;
      };
      return (result.transcripts ?? []).map((t) => t.text ?? "").join("\n").trim();
    }
    if (taskStatus === "FAILED") {
      throw new Error(
        `Qwen transcription failed: ${status.output?.message ?? JSON.stringify(status.output)}`,
      );
    }
  }

  throw new Error("Qwen transcription timed out after 2 minutes.");
}

/** Transcribe speaking audio in-process (no separate stt-api server). */
export async function transcribeSpeakingAudio(params: {
  buffer: Buffer;
  mimeType?: string;
  originalName?: string;
}): Promise<SpeakingTranscribeResult> {
  const model = sttModel();
  const language = sttLanguage();

  const ext =
    params.mimeType?.includes("mp4") || params.mimeType?.includes("m4a")
      ? ".m4a"
      : params.mimeType?.includes("mpeg") || params.mimeType?.includes("mp3")
        ? ".mp3"
        : params.mimeType?.includes("wav")
          ? ".wav"
          : ".m4a";

  if (model !== "qwen") {
    throw new Error(
      `STT model "${model}" is not supported in-process. Set STT_MODEL=qwen in backend/.env.`,
    );
  }

  const transcript = await qwenTranscribeFromBuffer(
    params.buffer,
    params.mimeType || "audio/m4a",
    params.originalName || `speaking${ext}`,
    language,
  );

  return {
    transcript,
    model,
    language,
  };
}
