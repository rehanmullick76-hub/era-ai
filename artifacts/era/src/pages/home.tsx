import React, { useEffect, useState } from "react";
import { useEraAuth } from "@/context/auth-context";
import { useLocation } from "wouter";
import {
  useListProjects,
  useCreateProject,
  useDeleteProject,
  getListProjectsQueryKey,
  useGetRuntimeCapabilities,
  useAiReadAttachments,
  useAiChat,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useApp,
  PENDING_PROMPT_KEY,
  PENDING_PROMPT_CONTEXT_KEY,
  PENDING_PROMPT_ATTACHMENTS_KEY,
  PENDING_PROMPT_PROJECT_KEY,
  PENDING_VIEW_KEY,
} from "@/context/app-context";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceInputButton } from "@/components/voice-input-button";
import {
  PromptAttachmentBadges,
  PromptAttachmentButton,
  PromptAttachmentFiles,
} from "@/components/prompt-attachment-picker";
import { cn } from "@/lib/utils";
import { appendRecognizedText } from "@/lib/speech-input";
import {
  clearPromptAttachmentStorage,
  getPromptAttachmentStorageKey,
  usePersistedPromptAttachments,
} from "@/hooks/use-persisted-prompt-attachments";
import {
  assertAttachmentReadRequestFits,
  composePromptWithAttachments,
  preparePromptAttachmentContext,
  promptAttachmentFingerprint,
  shouldAnswerQuestionAboutAttachments,
} from "@/lib/prompt-attachments";
import {
  Send, Trash2, Globe, Loader2,
  MonitorSmartphone, Smartphone, Menu, Zap,
} from "lucide-react";
import { format } from "date-fns";

const EXAMPLE_PROMPTS = [
  { color: "bg-green-500", text: "Portfolio dashboard for a crypto investor" },
  { color: "bg-blue-500", text: "Tutor marketplace for a single subject" },
  { color: "bg-purple-500", text: "CRM for a salon" },
  { color: "bg-orange-500", text: "Directory site for cafes in a city" },
  { color: "bg-pink-500", text: "Inventory tracker for a jewelry store" },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { openTab, closeTab, setMobileSidebarOpen, credits, user } = useApp();
  const { userId } = useEraAuth();

  const [prompt, setPrompt] = useState("");
  const [appType, setAppType] = useState<"web" | "mobile">("web");
  const [activeSection, setActiveSection] = useState<"tasks" | "deployed">("tasks");
  const [mode, setMode] = useState<"frontend" | "fullstack">("frontend");
  const { data: caps } = useGetRuntimeCapabilities();
  const fullstackAvailable = !!caps?.configured;
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const {
    files: promptAttachments,
    setFiles: setPromptAttachments,
    storageKey: promptAttachmentStorageKey,
    isRestoring: isRestoringAttachments,
    persistenceError: attachmentPersistenceError,
  } = usePersistedPromptAttachments(userId, "home");
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [isReadingAttachments, setIsReadingAttachments] = useState(false);
  const [preparedAttachmentCache, setPreparedAttachmentCache] = useState<{
    fingerprint: string;
    context: string;
  } | null>(null);
  const [attachmentAnswer, setAttachmentAnswer] = useState<{
    question: string;
    reply: string;
    model: string;
    files: string[];
  } | null>(null);

  const { data: projects, isLoading } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const aiReadAttachments = useAiReadAttachments();
  const aiChat = useAiChat();

  useEffect(() => {
    if (!attachmentPersistenceError) return;
    toast({
      title: "Attachments are not saved on this browser",
      description: "You can still use them now, but they may disappear after a reload.",
      variant: "destructive",
    });
  }, [attachmentPersistenceError, toast]);

  const handleSubmit = async (startWithPlan = false) => {
    if (isRestoringAttachments || isPreparingAttachments || createProject.isPending || (!prompt.trim() && promptAttachments.length === 0)) return;
    if (credits <= 0) {
      toast({ title: "No credits left", description: "Buy more credits to continue building.", variant: "destructive" });
      return;
    }
    const promptText = prompt.trim();
    const answerAttachmentQuestion =
      !startWithPlan && shouldAnswerQuestionAboutAttachments(promptText, promptAttachments);
    const projectDescription = promptText || "Create a website based on the attached reference files.";
    const fingerprint = promptAttachmentFingerprint(promptAttachments);
    setAttachmentAnswer(null);
    setIsPreparingAttachments(true);
    setIsReadingAttachments(promptAttachments.length > 0);
    try {
      if (answerAttachmentQuestion) {
        let directReply = "";
        let directModel = "";
        let gotDirectAnswer = false;
        const prepared = await preparePromptAttachmentContext(
          promptAttachments,
          async (attachments, referenceText) => {
            assertAttachmentReadRequestFits(attachments, referenceText, promptText);
            const result = await aiReadAttachments.mutateAsync({
              data: {
                attachments,
                question: promptText,
                ...(referenceText ? { referenceText } : {}),
              },
            });
            directReply = result.context;
            directModel = result.model;
            gotDirectAnswer = true;
            return { context: result.context, creditsCharged: result.creditsCharged };
          },
        );
        let reply = directReply;
        let model = directModel;
        if (!gotDirectAnswer) {
          const result = await aiChat.mutateAsync({
            data: {
              message: promptText,
              projectContext: prepared.context || undefined,
            },
          });
          reply = result.reply;
          model = result.model;
        }
        if (prepared.extraCredits > 0) {
          toast({
            title: "Answer ready",
            description: `Gemini used ${prepared.extraCredits} credit${prepared.extraCredits === 1 ? "" : "s"} to read the photo/PDF.`,
          });
        }
        setAttachmentAnswer({
          question: promptText,
          reply,
          model,
          files: promptAttachments.map(file => file.name),
        });
        setPrompt("");
        setPromptAttachments([]);
        setPreparedAttachmentCache(null);
        await clearPromptAttachmentStorage(promptAttachmentStorageKey).catch(() => undefined);
        return;
      }

      let attachmentContext = "";
      if (promptAttachments.length > 0) {
        if (preparedAttachmentCache?.fingerprint === fingerprint) {
          attachmentContext = preparedAttachmentCache.context;
        } else {
          const prepared = await preparePromptAttachmentContext(promptAttachments, async (attachments, referenceText) => {
            assertAttachmentReadRequestFits(attachments, referenceText);
            return aiReadAttachments.mutateAsync({ data: { attachments } });
          });
          attachmentContext = prepared.context;
          setPreparedAttachmentCache({ fingerprint, context: attachmentContext });
          if (prepared.extraCredits > 0) {
            toast({
              title: "Reference files read",
              description: `Gemini used ${prepared.extraCredits} credit${prepared.extraCredits === 1 ? "" : "s"} to read the photos/PDFs.`,
            });
          }
        }
      }
      setIsReadingAttachments(false);
      composePromptWithAttachments(
        promptText,
        attachmentContext,
        projectDescription,
      );
      const pendingPrompt = promptText || projectDescription;
      const name = (promptText || "new-project").slice(0, 50).trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-project";
      const project = await createProject.mutateAsync({
        data: { name, description: projectDescription, mode: fullstackAvailable ? mode : "frontend" },
      });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      openTab(project.id, project.name);
      try { sessionStorage.setItem(PENDING_PROMPT_KEY, pendingPrompt); } catch {}
      try { sessionStorage.setItem(PENDING_PROMPT_PROJECT_KEY, project.id); } catch {}
      try {
        if (attachmentContext) sessionStorage.setItem(PENDING_PROMPT_CONTEXT_KEY, attachmentContext);
        else sessionStorage.removeItem(PENDING_PROMPT_CONTEXT_KEY);
        if (promptAttachments.length > 0) {
          sessionStorage.setItem(
            PENDING_PROMPT_ATTACHMENTS_KEY,
            JSON.stringify(promptAttachments.map(file => file.name)),
          );
        } else {
          sessionStorage.removeItem(PENDING_PROMPT_ATTACHMENTS_KEY);
        }
      } catch {}
      if (startWithPlan) {
        try { sessionStorage.setItem(PENDING_VIEW_KEY, "plan"); } catch {}
      } else {
        try { sessionStorage.removeItem(PENDING_VIEW_KEY); } catch {}
      }
      setPromptAttachments([]);
      await clearPromptAttachmentStorage(promptAttachmentStorageKey).catch(() => undefined);
      setLocation(`/projects/${project.id}`);
      setPrompt("");
      setPreparedAttachmentCache(null);
    } catch (error) {
      const serverMessage = (error as { data?: { error?: string } })?.data?.error;
      toast({
        title: answerAttachmentQuestion ? "Could not answer that" : "Could not start the project",
        description: serverMessage ?? (error instanceof Error ? error.message : "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsReadingAttachments(false);
      setIsPreparingAttachments(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Permanently delete this project, its source files, its workspace runtime, and all records in its project database? This cannot be undone.")) return;
    setDeleteId(id);
    deleteProject.mutate({ id }, {
      onSuccess: () => {
        localStorage.removeItem(`era_chat_${id}`);
        void Promise.all([
          clearPromptAttachmentStorage(getPromptAttachmentStorageKey(userId, `project:${id}:build`)),
          clearPromptAttachmentStorage(getPromptAttachmentStorageKey(userId, `project:${id}:plan`)),
        ]).catch(() => undefined);
        closeTab(id);
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setDeleteId(null);
      },
      onError: (err) => { const d = (err as { data?: { error?: string } }).data; toast({ title: "Could not delete project", description: d?.error ?? "ERA kept your project data. Retry after the workspace cleanup issue is resolved.", variant: "destructive" }); setDeleteId(null); },
    });
  };

  const handleOpenProject = (id: string, name: string) => {
    openTab(id, name);
    setLocation(`/projects/${id}`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="era-tab-bar h-11 flex items-center px-3 gap-2 shrink-0">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="md:hidden text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-white/5"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>

        <span className="text-sm text-muted-foreground">Home</span>
        <div className="flex-1" />

        {/* Credits chip — mobile */}
        <div className="flex items-center gap-1 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-2.5 py-1 md:hidden">
          <Zap className="w-3 h-3 text-yellow-400" />
          <span className="text-xs font-semibold text-yellow-400">{credits}</span>
        </div>

        {/* User avatar */}
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 cursor-pointer"
          style={{ backgroundColor: user.avatarColor }}
          title={user.name}
        >
          {user.avatarLetter}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-12">

          {/* Hero */}
          <h1 className="text-2xl sm:text-3xl font-semibold text-center text-foreground mb-2 tracking-tight">
            Start with one prompt.
          </h1>
          <p className="text-center text-muted-foreground mb-6 sm:mb-8 text-sm">
            You can change everything later.
          </p>

          {/* App type selector */}
          <div className="flex justify-center mb-4 sm:mb-5">
            <div className="flex bg-secondary rounded-full p-0.5 gap-0.5">
              <button
                onClick={() => setAppType("web")}
                className={cn(
                  "flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all",
                  appType === "web" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MonitorSmartphone className="w-3.5 h-3.5" />
                Web App
              </button>
              <button
                onClick={() => setAppType("mobile")}
                className={cn(
                  "flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all",
                  appType === "mobile" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Mobile App
              </button>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2" data-testid="select-project-mode">
            {([["frontend", "Frontend only", "Static website, previewed instantly."], ["fullstack", "Full-stack", "Generate frontend, backend, and database for a private preview."]] as const).map(([m, t, d]) => (
              <button key={m} type="button" disabled={m === "fullstack" && !fullstackAvailable} onClick={() => setMode(m)}
                data-testid={`button-mode-${m}`}
                className={cn("text-left rounded-xl border p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  mode === m && (m === "frontend" || fullstackAvailable) ? "border-green-500/50 bg-green-500/5" : "border-border bg-secondary/40 hover:bg-secondary")}>
                <p className="text-sm font-medium text-foreground">{t}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{d}</p>
              </button>
            ))}
            {mode === "fullstack" && fullstackAvailable && (
              <p className="col-span-2 text-[11px] text-muted-foreground">
                {caps?.enabled
                  ? "Free trial runtimes start when Preview opens, stop when you leave, and suspend after 10 idle minutes. Provisioning is capped per user and globally."
                  : caps?.notice}
              </p>
            )}
            {!fullstackAvailable && caps?.notice && <p className="col-span-2 text-[11px] text-muted-foreground">{caps.notice}</p>}
          </div>

          {/* Prompt textarea */}
          <div className="era-input-bg rounded-xl p-3 sm:p-4 mb-4">
            <PromptAttachmentFiles
              files={promptAttachments}
              disabled={isRestoringAttachments || isPreparingAttachments || createProject.isPending}
              onFilesChange={files => {
                setPromptAttachments(files);
                setPreparedAttachmentCache(null);
              }}
            />
            <textarea
              className="w-full bg-transparent text-foreground placeholder:text-muted-foreground resize-none outline-none text-sm leading-relaxed min-h-[90px] sm:min-h-[100px]"
              placeholder="Describe your idea we will bring it to life..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRestoringAttachments || isPreparingAttachments || createProject.isPending}
            />
            <div className="flex items-center justify-between mt-2 sm:mt-3">
              <PromptAttachmentButton
                files={promptAttachments}
                onFilesChange={files => {
                  setPromptAttachments(files);
                  setPreparedAttachmentCache(null);
                }}
                disabled={isRestoringAttachments || isPreparingAttachments || createProject.isPending}
              />
              <div className="flex items-center gap-2">
                <VoiceInputButton
                  onTranscript={transcript => setPrompt(current => appendRecognizedText(current, transcript))}
                  disabled={isRestoringAttachments || isPreparingAttachments || createProject.isPending}
                />
                <button
                  onClick={() => handleSubmit(true)}
                  disabled={(!prompt.trim() && promptAttachments.length === 0) || isRestoringAttachments || isPreparingAttachments || createProject.isPending}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-purple-500/30 text-purple-300 hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Open the plan before generating code"
                >
                  {isRestoringAttachments
                    ? "Restoring files…"
                    : isReadingAttachments
                      ? "Reading files…"
                      : createProject.isPending
                        ? "Creating project…"
                        : isPreparingAttachments
                          ? "Starting project…"
                          : "Plan first"}
                </button>
                <button
                  onClick={() => handleSubmit(false)}
                  disabled={(!prompt.trim() && promptAttachments.length === 0) || isRestoringAttachments || isPreparingAttachments || createProject.isPending}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                    (prompt.trim() || promptAttachments.length > 0) && !isRestoringAttachments && !isPreparingAttachments && !createProject.isPending
                      ? "bg-green-500 text-black hover:bg-green-400"
                      : "bg-secondary text-muted-foreground cursor-not-allowed"
                  )}
                  title={
                    isReadingAttachments
                      ? "Reading attached files"
                      : createProject.isPending
                        ? "Creating project"
                        : "Build now"
                  }
                >
                  {isRestoringAttachments || isPreparingAttachments || createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {attachmentAnswer && (
            <section className="mb-4 rounded-xl border border-blue-500/25 bg-blue-500/5 p-3 sm:p-4" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-foreground">ERA’s answer</h2>
                <span className="truncate text-[10px] text-muted-foreground">{attachmentAnswer.model}</span>
              </div>
              <PromptAttachmentBadges names={attachmentAnswer.files} />
              <p className="mb-2 text-xs text-muted-foreground">{attachmentAnswer.question}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{attachmentAnswer.reply}</p>
            </section>
          )}

          {/* Low credit warning */}
          {credits < 20 && (
            <div className="mb-4 flex items-center gap-2 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-2.5 text-xs text-yellow-400">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>Only <strong>{credits}</strong> credits left. Buy more to keep building.</span>
            </div>
          )}

          {/* Example prompts */}
          <div className="mb-8 sm:mb-10">
            <div className="flex items-center gap-2 mb-2.5 sm:mb-3">
              <span className="text-xs text-muted-foreground">Not sure where to start? Try these</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setPrompt(p.text)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground bg-secondary hover:bg-secondary/80 px-3 py-1.5 rounded-full transition-colors border border-border/30"
                >
                  <span className={cn("w-2 h-2 rounded-full shrink-0", p.color)} />
                  <span className="hidden sm:inline">{p.text}</span>
                  <span className="sm:hidden">{p.text.split(" ").slice(0, 3).join(" ")}…</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recent Tasks / Deployed Apps */}
          <div>
            <div className="flex items-center gap-4 mb-4 border-b border-border">
              <button
                onClick={() => setActiveSection("tasks")}
                className={cn(
                  "text-sm pb-2.5 font-medium transition-colors border-b-2 -mb-px",
                  activeSection === "tasks" ? "text-foreground border-foreground" : "text-muted-foreground border-transparent hover:text-foreground"
                )}
              >
                Recent Tasks
              </button>
              <button
                onClick={() => setActiveSection("deployed")}
                className={cn(
                  "flex items-center gap-1.5 text-sm pb-2.5 font-medium transition-colors border-b-2 -mb-px",
                  activeSection === "deployed" ? "text-foreground border-foreground" : "text-muted-foreground border-transparent hover:text-foreground"
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                Deployed Apps
              </button>
            </div>

            {activeSection === "tasks" && (
              <div>
                {isLoading ? (
                  <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : !projects || projects.length === 0 ? (
                  <div className="text-center py-10 sm:py-12 text-muted-foreground text-sm">
                    No tasks yet. Start with a prompt above.
                  </div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden sm:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground border-b border-border">
                            <th className="pb-2 font-medium">Task</th>
                            <th className="pb-2 font-medium text-right">Last Modified</th>
                            <th className="pb-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {projects.map((p) => (
                            <tr
                              key={p.id}
                              onClick={() => handleOpenProject(p.id, p.name)}
                              className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer transition-colors group"
                            >
                              <td className="py-3 pr-4">
                                <p className="text-foreground font-medium text-sm truncate max-w-xs">{p.name}</p>
                                {p.description && (
                                  <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{p.description}</p>
                                )}
                              </td>
                              <td className="py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                                {format(new Date(p.updatedAt), "MMM d, h:mm a")}
                              </td>
                              <td className="py-3">
                                <button
                                  onClick={(e) => handleDelete(e, p.id)}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                  aria-label={`Delete project ${p.name}`}
                                  title="Delete project"
                                >
                                  {deleteId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile card list */}
                    <div className="sm:hidden space-y-2">
                      {projects.map((p) => (
                        <div
                          key={p.id}
                          onClick={() => handleOpenProject(p.id, p.name)}
                          className="flex items-center justify-between p-3 rounded-xl bg-card border border-border hover:border-border/80 cursor-pointer transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(p.updatedAt), "MMM d")}
                            </p>
                          </div>
                          <button
                            onClick={(e) => handleDelete(e, p.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-2 ml-2"
                          >
                            {deleteId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      ))}
                    </div>

                    {projects && (
                      <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                        <span>Showing 1–{projects.length} of {projects.length}</span>
                        <span>Tasks per page: 50</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeSection === "deployed" && (
              <div className="text-center py-10 sm:py-12 text-muted-foreground text-sm">
                No deployed apps yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
