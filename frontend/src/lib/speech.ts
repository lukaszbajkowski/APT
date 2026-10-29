// Czytanie wiadomości głosem i dyktowanie – przez wbudowane funkcje przeglądarki (Web Speech API).
// Nic z tego nie przechodzi przez nasz serwer. Uwaga: przy dyktowaniu przeglądarka może wysyłać dźwięk do
// swojego dostawcy rozpoznawania mowy (Chrome – Google, Safari – Apple).

const FIX: Record<string, string> = { iw: "he", jw: "jv", zh: "zh-CN", fil: "fil-PH", pl: "pl-PL" };

/** Kod języka z usługi tłumaczenia -> znacznik BCP-47 rozumiany przez syntezę i rozpoznawanie mowy. */
export function speechLang(code: string | null | undefined): string {
  const c = (code ?? "pl").trim();
  return FIX[c] ?? c;
}

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Recognition = (): any => (typeof window === "undefined" ? undefined : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);
export const canDictate = () => !!Recognition();

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** Czyta tekst. Zwraca "no-voice", gdy urządzenie nie ma głosu w tym języku (wtedy nic nie czyta). */
export function speak(text: string, lang: string, onEnd: () => void): "ok" | "no-voice" {
  const synth = window.speechSynthesis;
  synth.cancel();
  const voices = synth.getVoices();
  const base = lang.split("-")[0].toLowerCase();
  const voice = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base);
  if (voices.length > 0 && !voice) return "no-voice";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang ?? lang;
  if (voice) u.voice = voice;
  u.rate = 0.95;
  u.onend = onEnd;
  u.onerror = onEnd;
  synth.speak(u);
  return "ok";
}

/** Dyktowanie: wywołuje onText z całym dotychczasowym rozpoznanym tekstem; zwraca funkcję zatrzymującą. */
export function dictate(lang: string, onText: (text: string) => void, onEnd: (error?: string) => void): () => void {
  const R = Recognition();
  const rec = new R();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onresult = (e: any) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    onText(text.trim());
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onerror = (e: any) => onEnd(e.error);
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}
