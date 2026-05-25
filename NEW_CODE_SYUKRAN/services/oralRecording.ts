import { Platform } from "react-native";

export type OralRecordingResult = {
  uri: string;
  filename: string;
  mimeType: string;
  blob?: Blob;
};

type WebRecorderState = {
  mediaRecorder: MediaRecorder;
  stream: MediaStream;
  chunks: BlobPart[];
};

let webRecorder: WebRecorderState | null = null;
let nativeRecording: { stopAndUnloadAsync: () => Promise<void>; getURI: () => string | null } | null =
  null;

function pickWebMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t));
}

export function isOralRecordingSupported(): boolean {
  if (Platform.OS === "web") {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined" &&
      !!pickWebMimeType()
    );
  }
  return true;
}

export async function startOralRecording(): Promise<void> {
  if (Platform.OS === "web") {
    if (!isOralRecordingSupported()) {
      throw new Error("This browser does not support microphone recording.");
    }
    const mimeType = pickWebMimeType()!;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    mediaRecorder.start();
    webRecorder = { mediaRecorder, stream, chunks };
    return;
  }

  const { Audio } = await import("expo-av");
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Microphone permission is required to record your answer.");
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await rec.startAsync();
  nativeRecording = rec;
}

export async function stopOralRecording(): Promise<OralRecordingResult> {
  if (Platform.OS === "web") {
    const state = webRecorder;
    if (!state) {
      throw new Error("No active recording.");
    }

    const { mediaRecorder, stream, chunks } = state;
    webRecorder = null;

    const blob = await new Promise<Blob>((resolve, reject) => {
      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || pickWebMimeType() || "audio/webm";
        resolve(new Blob(chunks, { type: mimeType }));
      };
      mediaRecorder.onerror = () => reject(new Error("Recording failed in browser."));
      mediaRecorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    });

    const ext = blob.type.includes("mp4") ? "m4a" : "webm";
    const filename = `recording.${ext}`;
    const uri = URL.createObjectURL(blob);
    return { uri, filename, mimeType: blob.type || "audio/webm", blob };
  }

  const rec = nativeRecording;
  if (!rec) {
    throw new Error("No active recording.");
  }
  nativeRecording = null;

  const { Audio } = await import("expo-av");
  await rec.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

  const uri = rec.getURI();
  if (!uri) {
    throw new Error("Recording failed — no audio file.");
  }

  const filename = uri.split("/").pop()?.includes(".")
    ? (uri.split("/").pop() as string)
    : "recording.m4a";
  const mimeType = filename.endsWith(".wav")
    ? "audio/wav"
    : filename.endsWith(".mp3")
      ? "audio/mpeg"
      : "audio/mp4";

  return { uri, filename, mimeType };
}

export async function cancelOralRecording(): Promise<void> {
  if (Platform.OS === "web") {
    if (!webRecorder) return;
    webRecorder.mediaRecorder.stop();
    webRecorder.stream.getTracks().forEach((t) => t.stop());
    webRecorder = null;
    return;
  }
  if (!nativeRecording) return;
  try {
    const { Audio } = await import("expo-av");
    await nativeRecording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  } catch {
    // ignore cleanup errors
  }
  nativeRecording = null;
}
