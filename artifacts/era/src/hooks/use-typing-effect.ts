import { useState, useEffect, useRef } from "react";

/**
 * Reveals `text` character-by-character at `speed` ms per character.
 * Returns { displayed, isDone }.
 */
export function useTypingEffect(text: string, speed = 8) {
  const [displayed, setDisplayed] = useState("");
  const [isDone, setIsDone] = useState(false);
  const indexRef = useRef(0);
  const textRef = useRef(text);

  useEffect(() => {
    // Reset whenever the source text changes
    textRef.current = text;
    indexRef.current = 0;
    setDisplayed("");
    setIsDone(false);

    if (!text) { setIsDone(true); return; }

    const id = setInterval(() => {
      const next = indexRef.current + 1;
      // Reveal in small chunks so long texts finish quickly
      const chunk = Math.ceil(textRef.current.length / 400) + 1;
      const end = Math.min(next + chunk, textRef.current.length);
      indexRef.current = end;
      setDisplayed(textRef.current.slice(0, end));
      if (end >= textRef.current.length) {
        setIsDone(true);
        clearInterval(id);
      }
    }, speed);

    return () => clearInterval(id);
  }, [text, speed]);

  return { displayed, isDone };
}
