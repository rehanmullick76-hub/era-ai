import { Paperclip, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { validatePromptAttachmentSelection } from "@/lib/prompt-attachments";

const ACCEPTED_PROMPT_FILES = [
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  ".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".css",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".sql", ".yaml",
  ".yml", ".xml", ".svg", ".log", ".sh",
].join(",");

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function handleSelection(
  event: React.ChangeEvent<HTMLInputElement>,
  files: File[],
  onFilesChange: (files: File[]) => void,
  showToast: ReturnType<typeof useToast>["toast"],
) {
  const selected = Array.from(event.target.files ?? []);
  event.target.value = "";
  if (selected.length === 0) return;

  const existing = new Set(files.map(file => `${file.name}:${file.size}:${file.lastModified}`));
  const next = [
    ...files,
    ...selected.filter(file => !existing.has(`${file.name}:${file.size}:${file.lastModified}`)),
  ];
  const error = validatePromptAttachmentSelection(next);
  if (error) {
    showToast({ title: "Could not attach files", description: error, variant: "destructive" });
    return;
  }
  onFilesChange(next);
}

export function PromptAttachmentButton({
  files,
  onFilesChange,
  disabled = false,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();

  return (
    <label
      className={cn(
        "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-within:ring-2 focus-within:ring-ring",
        disabled && "pointer-events-none opacity-50",
      )}
      title="Attach files"
    >
      <input
        type="file"
        className="sr-only"
        accept={ACCEPTED_PROMPT_FILES}
        multiple
        disabled={disabled}
        onChange={event => handleSelection(event, files, onFilesChange, toast)}
        aria-label="Attach files"
        data-testid="input-prompt-attachments"
      />
      <Paperclip className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Attach files</span>
    </label>
  );
}

export function PromptAttachmentFiles({
  files,
  onFilesChange,
  disabled = false,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  if (files.length === 0) return null;

  return (
    <div className="mb-2" data-testid="prompt-attachment-files">
      <div className="flex w-full flex-wrap items-center justify-start gap-1.5">
        {files.map((file, index) => (
          <span
            key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary/70 px-2 py-1 text-[10px] text-foreground/80"
            title={`${file.name} · ${formatFileSize(file.size)}`}
          >
            <span className="max-w-[150px] truncate">{file.name}</span>
            <span className="shrink-0 text-muted-foreground">{formatFileSize(file.size)}</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))}
              disabled={disabled}
              aria-label={`Remove ${file.name}`}
              title={`Remove ${file.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PromptAttachmentBadges({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5" aria-label="Attached files">
      {names.map((name, index) => (
        <span
          key={`${name}:${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2 py-1 text-[10px] text-muted-foreground"
          title={name}
        >
          <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="max-w-[180px] truncate">{name}</span>
        </span>
      ))}
    </div>
  );
}
