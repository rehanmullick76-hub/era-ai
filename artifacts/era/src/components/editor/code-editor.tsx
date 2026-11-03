import React, { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface CodeEditorProps {
  content: string;
  onChange: (content: string) => void;
  language?: string;
  className?: string;
}

export function CodeEditor({ content, onChange, language, className }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea logic could go here, or just let it scroll
  // We use a simple textarea for now as requested (no Monaco)
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Basic tab support
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const target = e.currentTarget;
      
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      onChange(newContent);
      
      // We need to defer setting the selection until after React updates the DOM
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  // Add line numbers roughly
  const lineCount = content.split('\n').length;
  const lines = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1);

  return (
    <div className={cn("w-full h-full flex bg-[#0d0d0d] text-[#d4d4d4] font-mono text-sm leading-relaxed", className)}>
      {/* Gutter / Line numbers */}
      <div ref={gutterRef} className="w-12 py-4 flex flex-col items-end px-3 select-none text-muted-foreground/40 bg-black/20 border-r border-border/50 shrink-0 overflow-hidden font-mono text-xs">
        {lines.map(line => (
          <div key={line} className="h-[1.5rem]">{line}</div>
        ))}
      </div>
      
      {/* Editor surface */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={e => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className="flex-1 w-full h-full resize-none bg-transparent outline-none p-4 font-mono text-sm leading-[1.5rem] whitespace-pre overflow-auto text-foreground"
        spellCheck={false}
      />
    </div>
  );
}
