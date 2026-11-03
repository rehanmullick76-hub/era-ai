import { useEffect } from "react";
import { Mic } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useSpeechInput } from "@/lib/speech-input";

interface VoiceInputButtonProps {
  onTranscript: (transcript: string) => void;
  disabled?: boolean;
  className?: string;
}

function getSpeechErrorMessage(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access was blocked. Allow it in your browser settings, then try again.";
  }
  if (error === "no-speech") return "No speech was detected. Try speaking again.";
  if (error === "network") return "Speech recognition needs a network connection. Try again when connected.";
  if (error === "unsupported") return "Voice input is not supported by this browser.";
  return "Voice input could not start. Check microphone access and try again.";
}

export function VoiceInputButton({ onTranscript, disabled, className }: VoiceInputButtonProps) {
  const { toast } = useToast();
  const { isSupported, isListening, error, toggleListening } = useSpeechInput(onTranscript, Boolean(disabled));

  useEffect(() => {
    if (!error) return;
    toast({
      title: "Voice input",
      description: getSpeechErrorMessage(error),
      variant: "destructive",
    });
  }, [error, toast]);

  const unavailable = !isSupported || Boolean(disabled);
  return (
    <button
      type="button"
      onClick={toggleListening}
      disabled={unavailable}
      aria-label={isListening ? "Stop voice input" : "Start voice input"}
      aria-pressed={isListening}
      title={
        !isSupported
          ? "Voice input is not supported in this browser"
          : isListening
            ? "Stop voice input"
            : "Start voice input"
      }
      data-testid="button-voice-input"
      className={cn(
        "flex items-center justify-center rounded-md p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        isListening ? "bg-red-500/10 text-red-400 hover:bg-red-500/20" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Mic className={cn("h-4 w-4", isListening && "animate-pulse")} />
    </button>
  );
}
