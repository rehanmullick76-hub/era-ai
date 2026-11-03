import React from "react";
import { ProjectFile } from "@workspace/api-client-react";
import { FileCode2, FileJson, FileText, FileImage, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  files: ProjectFile[];
  activeFile: ProjectFile | null;
  onSelect: (file: ProjectFile) => void;
  projectId: string;
}

export function FileTree({ files, activeFile, onSelect, projectId }: FileTreeProps) {
  // A simple flat list for now, styled to look like a tree
  // Real implementation would parse paths into a tree structure

  const getIconForFile = (filename: string) => {
    if (filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.tsx')) return <FileCode2 className="w-4 h-4 text-yellow-500" />;
    if (filename.endsWith('.json')) return <FileJson className="w-4 h-4 text-green-500" />;
    if (filename.endsWith('.css')) return <FileCode2 className="w-4 h-4 text-blue-500" />;
    if (filename.endsWith('.html')) return <FileCode2 className="w-4 h-4 text-orange-500" />;
    if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.svg')) return <FileImage className="w-4 h-4 text-purple-500" />;
    return <FileText className="w-4 h-4 text-muted-foreground" />;
  };

  // Sort files: index.html first, then alphabetical
  const sortedFiles = [...files].sort((a, b) => {
    if (a.path === "index.html") return -1;
    if (b.path === "index.html") return 1;
    return a.path.localeCompare(b.path);
  });

  return (
    <div className="py-2">
      {sortedFiles.map(file => {
        const isActive = activeFile?.id === file.id;
        const depth = (file.path.match(/\//g) || []).length;
        
        return (
          <div 
            key={file.id}
            onClick={() => onSelect(file)}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 cursor-pointer text-sm font-mono select-none transition-colors",
              isActive 
                ? "bg-primary/20 text-primary border-r-2 border-primary" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground border-r-2 border-transparent"
            )}
            style={{ paddingLeft: `${1 + depth * 1}rem` }}
          >
            {getIconForFile(file.path)}
            <span className="truncate">{file.path.split('/').pop()}</span>
          </div>
        );
      })}
      {files.length === 0 && (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          No files in this project yet.<br/>Use the chat to generate some!
        </div>
      )}
    </div>
  );
}
