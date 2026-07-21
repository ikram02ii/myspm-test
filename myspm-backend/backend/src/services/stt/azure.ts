import fs from "node:fs";
import path from "node:path";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { azureSpeechKey, azureSpeechRegion } from "./config";

export async function azureTranscribe(filePath: string, azureLang: string): Promise<string> {
  const key = azureSpeechKey();
  const region = azureSpeechRegion();
  if (!key || !region) {
    throw new Error("Azure Speech is not configured (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)");
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = azureLang;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp3" || ext === ".mpeg") {
    throw new Error(
      "Azure STT supports WAV only in this deployment. Use model qwen or openai for MP3, or record as WAV.",
    );
  }

  const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(filePath));

  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  const segments: string[] = [];

  return new Promise((resolve, reject) => {
    recognizer.recognized = (_sender, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        const t = e.result.text.trim();
        if (t) segments.push(t);
      }
    };
    recognizer.canceled = (_sender, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        reject(new Error(`Azure: ${e.errorDetails}`));
        return;
      }
      recognizer.stopContinuousRecognitionAsync(
        () => resolve(segments.join(" ")),
        (err) => reject(new Error(`Azure stop: ${err}`)),
      );
    };
    recognizer.sessionStopped = () => {
      recognizer.stopContinuousRecognitionAsync(
        () => resolve(segments.join(" ")),
        (err) => reject(new Error(`Azure stop: ${err}`)),
      );
    };
    recognizer.startContinuousRecognitionAsync(
      () => {},
      (err) => reject(new Error(`Azure start: ${err}`)),
    );
  });
}
