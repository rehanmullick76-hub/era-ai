import React, { useState } from "react";
import { useLocation } from "wouter";
import { useEraAuth } from "@/context/auth-context";
import {
  Globe, Bookmark, Plus, ChevronLeft, ChevronRight,
  Coins, ChevronDown, X, Zap, User, LogOut,
} from "lucide-react";
import { useListProjects, useCreateProject, createCreditOrder, verifyCreditPayment, getListProjectsQueryKey } from "@workspace/api-client-react";
import { openCreditCheckout, type PaymentResponse } from "@/lib/razorpay-checkout";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/context/app-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getApiErrorStatus } from "@/lib/ai-error-message";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const CREDIT_PACKAGES = [
  { id: "starter", label: "Starter", credits: 100, price: "₹2,000", color: "border-border" },
  { id: "pro", label: "Pro", credits: 500, price: "₹5,000", color: "border-green-500", badge: "Popular" },
  { id: "max", label: "Max", credits: 2000, price: "₹10,000", color: "border-purple-500" },
] as const;

function SidebarContent({
  onClose,
  setCreateOpen,
  setBuyOpen,
  setProfileOpen,
}: {
  onClose?: () => void;
  setCreateOpen: (v: boolean) => void;
  setBuyOpen: (v: boolean) => void;
  setProfileOpen: (v: boolean) => void;
}) {
  const { openTabs, openTab, closeTab, setActiveTabId, activeTabId, sidebarCollapsed, setSidebarCollapsed, credits, user } = useApp();
  const [, setLocation] = useLocation();
  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });

  const navigate = (path: string) => {
    setLocation(path);
    onClose?.();
  };

  const handleOpenProject = (id: string, name: string) => {
    openTab(id, name);
    navigate(`/projects/${id}`);
  };

  const activeTabs = openTabs;
  const recentProjects = projects?.filter(p => !openTabs.find(t => t.id === p.id)) ?? [];
  const creditPct = Math.min(100, (credits / 100) * 100);

  return (
    <div className="flex flex-col h-full">
      {/* Logo + collapse */}
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <button
          onClick={() => navigate("/")}
          className="text-white font-bold text-xl tracking-tight hover:opacity-80 transition-opacity"
          style={{ letterSpacing: "-0.03em" }}
        >
          era
        </button>
        {!onClose && (
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <div className="px-2 space-y-0.5 shrink-0">
        <button
          onClick={() => { setCreateOpen(true); onClose?.(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors hover:bg-white/5 text-green-400"
        >
          <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <Plus className="w-3 h-3 text-black" />
          </span>
          New Task
        </button>

        <button
          onClick={() => navigate("/")}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors hover:bg-white/5 text-muted-foreground hover:text-foreground"
        >
          <Globe className="w-4 h-4 shrink-0" />
          Deployed Apps
        </button>

        <button
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors hover:bg-white/5 text-muted-foreground hover:text-foreground"
        >
          <Bookmark className="w-4 h-4 shrink-0" />
          Showcase
        </button>
      </div>

      {/* Active Tasks */}
      {activeTabs.length > 0 && (
        <div className="mt-5 px-3 shrink-0">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5 px-2">Active Tasks</p>
          <div className="space-y-0.5">
            {activeTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer group transition-colors",
                  activeTabId === tab.id ? "text-foreground bg-white/8" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
                onClick={() => { setActiveTabId(tab.id); navigate(`/projects/${tab.id}`); }}
              >
                <span className="truncate text-xs">{tab.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); if (tab.id === activeTabId) navigate("/"); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground ml-1 shrink-0 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Tasks */}
      {recentProjects.length > 0 && (
        <div className="mt-4 px-3 shrink-0">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5 px-2">Recent Tasks</p>
          <div className="space-y-0.5">
            {recentProjects.slice(0, 8).map((p) => (
              <button
                key={p.id}
                onClick={() => handleOpenProject(p.id, p.name)}
                className="w-full text-left px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors truncate"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* Credits */}
      <div className="px-4 pb-3 shrink-0">
        <div className="bg-white/4 rounded-xl p-3 border border-white/8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-xs font-semibold text-foreground">{credits} Credits</span>
            </div>
            <button
              onClick={() => setBuyOpen(true)}
              className="text-[11px] font-bold bg-yellow-400 text-black px-2.5 py-1 rounded-full flex items-center gap-1 hover:bg-yellow-300 transition-colors"
            >
              Buy <Plus className="w-2.5 h-2.5" />
            </button>
          </div>
          <Progress
            value={creditPct}
            className="h-1.5"
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">{credits} credits available</p>
          <p className="text-[10px] leading-relaxed text-muted-foreground/80 mt-1">
            Generation credits = input ÷ 1,000 + output ÷ 500 tokens, rounded up (minimum 1).
          </p>
        </div>
      </div>

      {/* User */}
      <div className="px-3 pb-4 shrink-0">
        <button
          onClick={() => setProfileOpen(true)}
          className="w-full flex items-center gap-2.5 hover:bg-white/5 rounded-md p-2 transition-colors text-left"
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: user.avatarColor }}
          >
            {user.avatarLetter}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground font-medium truncate">{user.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  const {
    sidebarCollapsed, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen,
    credits, setCreditsFromServer, user, resetOpenTabs, setActiveTabId,
  } = useApp();
  const { signOut } = useEraAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const [buyOpen, setBuyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const { openTab } = useApp();
  const createProject = useCreateProject();
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PaymentResponse | null>(() => {
    try { return JSON.parse(localStorage.getItem("era_pending_payment") ?? "null"); } catch { return null; }
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createProject.mutate({ data: { name: newName, description: newDesc } }, {
      onSuccess: (project) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setCreateOpen(false);
        setNewName("");
        setNewDesc("");
        openTab(project.id, project.name);
        setLocation(`/projects/${project.id}`);
      },
      onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
    });
  };

  const handleBuyCredits = async (pkg: typeof CREDIT_PACKAGES[number]) => {
    if (paymentBusy) return;
    setPaymentBusy(true);
    let verificationPayment = pendingPayment;
    try {
      let payment = pendingPayment;
      if (!payment) {
        const order = await createCreditOrder({ packageId: pkg.id });
        // Release our dialog's focus trap before Razorpay mounts its own modal.
        setBuyOpen(false);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        payment = await openCreditCheckout(order, pkg.label);
      }
      if (!payment) { setBuyOpen(true); return; }
      verificationPayment = payment;
      setPendingPayment(payment);
      localStorage.setItem("era_pending_payment", JSON.stringify(payment));
      const result = await verifyCreditPayment(payment);
      setCreditsFromServer(result.credits);
      localStorage.removeItem("era_pending_payment");
      setPendingPayment(null);
      setBuyOpen(false);
      toast({ title: "Payment verified", description: `Your balance is ${result.credits} credits.` });
    } catch (err) {
      if (verificationPayment && getApiErrorStatus(err) === 400) {
        try { localStorage.removeItem("era_pending_payment"); } catch {}
        setPendingPayment(null);
      }
      setBuyOpen(true);
      toast({
        title: "Payment could not be completed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPaymentBusy(false);
    }
  };

  const handleSignOut = async () => {
    setProfileOpen(false);
    queryClient.clear();
    resetOpenTabs();
    setActiveTabId("home");
    await signOut();
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "era-sidebar flex-col h-full shrink-0 transition-all duration-200 overflow-hidden hidden md:flex",
          sidebarCollapsed ? "w-0" : "w-56"
        )}
      >
        <div className="min-w-[224px] h-full">
          <SidebarContent setCreateOpen={setCreateOpen} setBuyOpen={setBuyOpen} setProfileOpen={setProfileOpen} />
        </div>
      </aside>

      {/* Collapsed toggle — desktop only */}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-r-md p-1.5 text-muted-foreground hover:text-foreground transition-colors hidden md:flex"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Mobile sidebar sheet */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-56 era-sidebar border-r border-white/10 bg-[hsl(0_0%_9%)]">
          <SidebarContent
            onClose={() => setMobileSidebarOpen(false)}
            setCreateOpen={setCreateOpen}
            setBuyOpen={setBuyOpen}
            setProfileOpen={setProfileOpen}
          />
        </SheetContent>
      </Sheet>

      {/* Create Task Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>Give your project a name to get started.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-name">Project Name</Label>
              <Input
                id="task-name"
                placeholder="my-awesome-app"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-background"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Describe your app <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                id="task-desc"
                placeholder="What are you building?"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="bg-background resize-none"
                rows={3}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createProject.isPending}
              className="bg-green-600 hover:bg-green-500 text-white"
            >
              {createProject.isPending ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Buy Credits Dialog */}
      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              Buy Credits
            </DialogTitle>
            <DialogDescription>Credits power AI generation. Current balance: <strong className="text-yellow-400">{credits}</strong></DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {CREDIT_PACKAGES.map((pkg) => (
              <button
                key={pkg.label}
                onClick={() => void handleBuyCredits(pkg)}
                disabled={paymentBusy || !!pendingPayment}
                className={cn(
                  "flex items-center justify-between p-4 rounded-xl border-2 hover:bg-white/5 transition-all text-left disabled:cursor-not-allowed disabled:opacity-50",
                  pkg.color
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{pkg.label}</span>
                    {"badge" in pkg && pkg.badge && (
                      <span className="text-[10px] font-bold bg-green-500 text-black px-1.5 py-0.5 rounded-full">{pkg.badge}</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{pkg.credits} credits</p>
                </div>
                <span className="font-bold text-foreground text-lg">{pkg.price}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Secure checkout by Razorpay. Test-mode payments use no real money.
          </p>
          {pendingPayment && (
            <div className="flex gap-2">
              <Button className="flex-1" disabled={paymentBusy} onClick={() => void handleBuyCredits(CREDIT_PACKAGES[0])}>
                {paymentBusy ? "Verifying payment…" : "Retry payment verification"}
              </Button>
              <Button
                variant="outline"
                disabled={paymentBusy}
                onClick={() => {
                  try { localStorage.removeItem("era_pending_payment"); } catch {}
                  setPendingPayment(null);
                }}
              >
                Cancel / Start new order
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* User Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-4 h-4" />
              Your Profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Avatar preview */}
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0"
                style={{ backgroundColor: user.avatarColor }}
              >
                {user.avatarLetter}
              </div>
              <p className="text-sm text-muted-foreground">Your ERA account</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Display Name</Label>
              <Input
                id="profile-name"
                value={user.name}
                className="bg-background"
                placeholder="Your name"
                readOnly
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                value={user.email}
                className="bg-background"
                placeholder="your@email.com"
                type="email"
                readOnly
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Your name and email are managed by your sign-in provider.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setProfileOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleSignOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
