import { useEffect, useRef, Component, type ReactNode } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  useClerk,
  useUser,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import {
  Switch,
  Route,
  useLocation,
  useParams,
  Router as WouterRouter,
  Redirect,
} from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Import pages
import LandingPage from "@/pages/LandingPage";
import { Dashboard } from "@/pages/Dashboard";
import { OrganizationsList } from "@/pages/OrganizationsList";
import { OrganizationDetail } from "@/pages/OrganizationDetail";
import { WorkforceBrowser } from "@/pages/WorkforceBrowser";
import { SystemStatus } from "@/pages/SystemStatus";
import NotFound from "@/pages/not-found";
import OrgOnboarding from "@/pages/OrgOnboarding";
import AppHome from "@/pages/app/AppHome";
import AppDashboard from "@/pages/app/AppDashboard";
import ExecutiveDashboard from "@/pages/app/ExecutiveDashboard";
import ExecutiveInbox from "@/pages/app/ExecutiveInbox";
import ActiveWorkPage from "@/pages/app/ActiveWorkPage";
import NotificationCentrePage from "@/pages/app/NotificationCentrePage";
import GovernanceCentre from "@/pages/app/GovernanceCentre";
import KnowledgeHealthPage from "@/pages/app/KnowledgeHealthPage";
import GovernanceTimelinePage from "@/pages/app/GovernanceTimelinePage";
import CompletedWorkPortal from "@/pages/app/CompletedWorkPortal";
import CompletedWorkViewer from "@/pages/app/CompletedWorkViewer";
import TeamPage from "@/pages/app/TeamPage";
import OrgSettings from "@/pages/app/OrgSettings";
import AuditPage from "@/pages/app/AuditPage";
import AccountSettings from "@/pages/app/AccountSettings";
import InvitationAccept from "@/pages/InvitationAccept";
import WorkforcePage from "@/pages/app/WorkforcePage";
import WorkforceOpsCentre from "@/pages/app/WorkforceOpsCentre";
import WorkforceSpecialistDetail from "@/pages/app/WorkforceSpecialistDetail";
import TaskCentrePage from "@/pages/app/TaskCentrePage";
import TaskWorkroomPage from "@/pages/app/TaskWorkroomPage";
import WorkforceChatPage from "@/pages/app/WorkforceChatPage";
import ApprovalsPage from "@/pages/app/ApprovalsPage";
import OrgMemoryPage from "@/pages/app/OrgMemoryPage";
import OrgLibraryPage from "@/pages/app/OrgLibraryPage";
import SourceDetailPage from "@/pages/app/SourceDetailPage";
import SpecialistTrainingPage from "@/pages/app/SpecialistTrainingPage";
// Sprint 28 — Blueprint Studio
import BlueprintStudioPage from "@/pages/app/BlueprintStudioPage";
import BlueprintDetailPage from "@/pages/app/BlueprintDetailPage";
import BlueprintEditorPage from "@/pages/app/BlueprintEditorPage";
import BlueprintVersionHistoryPage from "@/pages/app/BlueprintVersionHistoryPage";
import BlueprintTestPage from "@/pages/app/BlueprintTestPage";
import BlueprintPublishPage from "@/pages/app/BlueprintPublishPage";
import PlanPage from "@/pages/app/PlanPage";
import UsagePage from "@/pages/app/UsagePage";
// Sprint 14 — Installer, Devices, Discovery
import InstallPage from "@/pages/app/InstallPage";
import DevicesPage from "@/pages/app/DevicesPage";
import DiscoveryPage from "@/pages/app/DiscoveryPage";
// Platform Console — Sprint 4
import PlatformDashboard from "@/pages/platform/PlatformDashboard";
import PlatformOrgs from "@/pages/platform/PlatformOrgs";
import PlatformOrgDetail from "@/pages/platform/PlatformOrgDetail";
import PlatformCommercial from "@/pages/platform/PlatformCommercial";
import PlatformTrials from "@/pages/platform/PlatformTrials";
import PlatformWorkforce from "@/pages/platform/PlatformWorkforce";
import PlatformUsage from "@/pages/platform/PlatformUsage";
import PlatformSupport from "@/pages/platform/PlatformSupport";
import PlatformSecurity from "@/pages/platform/PlatformSecurity";
import PlatformAudit from "@/pages/platform/PlatformAudit";
import PlatformSettings from "@/pages/platform/PlatformSettings";
import PlatformRuntime from "@/pages/platform/PlatformRuntime";
import SpecialistOpsPage from "@/pages/platform/SpecialistOpsPage";
import PlatformPacksPage from "@/pages/platform/PlatformPacksPage";
import PlatformStaff from "@/pages/platform/PlatformStaff";
import PlatformConnectorFleet from "@/pages/platform/PlatformConnectorFleet";
import PlatformCataloguePage from "@/pages/platform/PlatformCataloguePage";
import { useOrgRole }       from "@/hooks/useOrgRole";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// REQUIRED — copy verbatim
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");

// ── Sprint 29N.10: Route-level knowledge-admin guard ─────────────────────────
// Wraps a page component so that only owners/administrators can navigate to it.
// Non-admin users are silently redirected to the org dashboard; the nav already
// hides the link, so this acts as the URL-level safety net (direct-URL access).
//
// Defined at module scope so React never recreates the component class between
// renders — creating a HOC inside a render loop causes React to unmount/remount
// the subtree on every render.
function withKnowledgeAdminGuard<P extends object>(
  Component: React.ComponentType<P>,
) {
  function GuardedComponent(props: P) {
    const { slug }                          = useParams<{ slug: string }>();
    const { isKnowledgeAdmin, isLoading }   = useOrgRole(slug);
    const [, nav]                           = useLocation();

    useEffect(() => {
      if (!isLoading && !isKnowledgeAdmin) {
        nav(`/app/${slug}`);
      }
    }, [isKnowledgeAdmin, isLoading, slug, nav]);

    if (isLoading)          return null;
    if (!isKnowledgeAdmin)  return null;
    return <Component {...props} />;
  }
  GuardedComponent.displayName =
    `KnowledgeAdminGuarded(${Component.displayName ?? Component.name ?? "Component"})`;
  return GuardedComponent;
}

const GuardedBlueprintStudioPage         = withKnowledgeAdminGuard(BlueprintStudioPage);
const GuardedBlueprintDetailPage         = withKnowledgeAdminGuard(BlueprintDetailPage);
const GuardedBlueprintEditorPage         = withKnowledgeAdminGuard(BlueprintEditorPage);
const GuardedBlueprintVersionHistoryPage = withKnowledgeAdminGuard(BlueprintVersionHistoryPage);
const GuardedBlueprintTestPage           = withKnowledgeAdminGuard(BlueprintTestPage);
const GuardedBlueprintPublishPage        = withKnowledgeAdminGuard(BlueprintPublishPage);
const GuardedOrgMemoryPage               = withKnowledgeAdminGuard(OrgMemoryPage);

// ── Error Boundary ────────────────────────────────────────────────────────────
// Guards against Clerk internal errors (e.g. checkOrgAuthorization crashing
// when orgMembership is undefined on users without Clerk org membership).
class ClerkErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    // Clerk internally calls checkOrgAuthorization(undefined) when <Show> renders
    // without org membership, which crashes at undefined.role. Do a clean page
    // reload so Clerk reinitialises with correct state rather than looping.
    const isClerkAuthError =
      error.message?.includes("Cannot read properties of undefined") ||
      error.message?.includes("orgMembership") ||
      error.message?.includes("checkOrgAuthorization");
    if (isClerkAuthError) {
      window.location.reload();
    }
  }
  render() {
    // Render null briefly while the reload triggers; avoids a blank screen flash.
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "#0B1829", color: "#64748B", fontSize: 14 }}>
          Reconnecting…
        </div>
      );
    }
    return this.props.children;
  }
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#00D4FF",
    colorForeground: "#E2E8F0",
    colorMutedForeground: "#64748B",
    colorDanger: "#F87171",
    colorBackground: "#112033",
    colorInput: "#0B1829",
    colorInputForeground: "#E2E8F0",
    colorNeutral: "#1E3A5F",
    fontFamily: "Outfit, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#112033] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl shadow-black/40 border border-[#1E3A5F]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#E2E8F0] font-semibold",
    headerSubtitle: "text-[#64748B]",
    socialButtonsBlockButtonText: "text-[#E2E8F0]",
    formFieldLabel: "text-[#E2E8F0]",
    footerActionLink: "text-[#00D4FF]",
    footerActionText: "text-[#64748B]",
    dividerText: "text-[#64748B]",
    identityPreviewEditButton: "text-[#00D4FF]",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-[#E2E8F0]",
    logoBox: "mb-2",
    logoImage: "h-12 w-12",
    socialButtonsBlockButton: "border-[#1E3A5F] hover:border-[#00D4FF] bg-[#0B1829]",
    formButtonPrimary: "bg-[#00D4FF] text-[#0B1829] hover:bg-[#00B8D9] font-semibold",
    formFieldInput: "bg-[#0B1829] border-[#1E3A5F] text-[#E2E8F0]",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#1E3A5F]",
    alert: "bg-[#0B1829] border-[#1E3A5F]",
    otpCodeFieldInput: "bg-[#0B1829] border-[#1E3A5F] text-[#E2E8F0]",
    main: "gap-4",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0B1829] px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0B1829] px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function HomeRedirect() {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return null;
  return isSignedIn ? <Redirect to="/app-home" /> : <LandingPage />;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

function AppRouter() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Welcome back", subtitle: "Sign in to NeedsOps AI+" } },
        signUp: { start: { title: "Get started", subtitle: "Create your NeedsOps AI+ account" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/onboarding" component={OrgOnboarding} />
            <Route path="/invitations/:token/accept" component={InvitationAccept} />
            <Route path="/app-home" component={AppHome} />
            <Route path="/app/:slug/chat" component={WorkforceChatPage} />
            <Route path="/app/:slug/workforce" component={WorkforcePage} />
            {/* Sprint 26 — Workforce Operations Centre (before :specialistId/training) */}
            <Route path="/app/:slug/workforce-ops/:specialistId" component={WorkforceSpecialistDetail} />
            <Route path="/app/:slug/workforce-ops" component={WorkforceOpsCentre} />
            <Route path="/app/:slug/tasks/:taskId" component={TaskWorkroomPage} />
            <Route path="/app/:slug/tasks" component={TaskCentrePage} />
            <Route path="/app/:slug/approvals" component={ApprovalsPage} />
            <Route path="/app/:slug/team" component={TeamPage} />
            <Route path="/app/:slug/plan" component={PlanPage} />
            <Route path="/app/:slug/usage" component={UsagePage} />
            <Route path="/app/:slug/settings" component={OrgSettings} />
            <Route path="/app/:slug/audit" component={AuditPage} />
            <Route path="/app/:slug/library/:sourceId" component={SourceDetailPage} />
            <Route path="/app/:slug/library" component={OrgLibraryPage} />
            <Route path="/app/:slug/workforce/:specialistId/training" component={SpecialistTrainingPage} />
            {/* Sprint 29N.10: memory gated to knowledge admins (owner/administrator) */}
            <Route path="/app/:slug/memory" component={GuardedOrgMemoryPage} />
            {/* Sprint 14 — Installer, Devices, Discovery */}
            <Route path="/app/:slug/install" component={InstallPage} />
            <Route path="/app/:slug/devices" component={DevicesPage} />
            <Route path="/app/:slug/discover" component={DiscoveryPage} />
            {/* Sprint 28 — Blueprint Studio gated to knowledge admins (Sprint 29N.10) */}
            <Route path="/app/:slug/blueprints/new" component={GuardedBlueprintEditorPage} />
            <Route path="/app/:slug/blueprints/:id/edit" component={GuardedBlueprintEditorPage} />
            <Route path="/app/:slug/blueprints/:id/versions" component={GuardedBlueprintVersionHistoryPage} />
            <Route path="/app/:slug/blueprints/:id/test" component={GuardedBlueprintTestPage} />
            <Route path="/app/:slug/blueprints/:id/publish" component={GuardedBlueprintPublishPage} />
            <Route path="/app/:slug/blueprints/:id" component={GuardedBlueprintDetailPage} />
            <Route path="/app/:slug/blueprints" component={GuardedBlueprintStudioPage} />
            {/* Sprint 25 — Completed Work Portal (more-specific before :slug catch-all) */}
            <Route path="/app/:slug/work/:id" component={CompletedWorkViewer} />
            <Route path="/app/:slug/work" component={CompletedWorkPortal} />
            {/* Sprint 23 — Executive Workspace */}
            <Route path="/app/:slug/inbox" component={ExecutiveInbox} />
            <Route path="/app/:slug/active-work" component={ActiveWorkPage} />
            <Route path="/app/:slug/notifications" component={NotificationCentrePage} />
            {/* Sprint 24 — Governance Centre (more-specific paths before :slug catch-all) */}
            <Route path="/app/:slug/governance/knowledge-health" component={KnowledgeHealthPage} />
            <Route path="/app/:slug/governance/timeline" component={GovernanceTimelinePage} />
            <Route path="/app/:slug/governance" component={GovernanceCentre} />
            <Route path="/app/:slug" component={ExecutiveDashboard} />
            <Route path="/account" component={AccountSettings} />
            {/* Platform Console — Sprint 4 */}
            <Route path="/platform/organisations/:id" component={PlatformOrgDetail} />
            <Route path="/platform/organisations" component={PlatformOrgs} />
            <Route path="/platform/commercial" component={PlatformCommercial} />
            <Route path="/platform/trials" component={PlatformTrials} />
            <Route path="/platform/workforce" component={PlatformWorkforce} />
            <Route path="/platform/usage" component={PlatformUsage} />
            <Route path="/platform/support" component={PlatformSupport} />
            <Route path="/platform/security" component={PlatformSecurity} />
            <Route path="/platform/audit" component={PlatformAudit} />
            <Route path="/platform/settings" component={PlatformSettings} />
            <Route path="/platform/runtime" component={PlatformRuntime} />
            <Route path="/platform/specialist-ops" component={SpecialistOpsPage} />
            <Route path="/platform/packs" component={PlatformPacksPage} />
            <Route path="/platform/staff" component={PlatformStaff} />
            <Route path="/platform/connector-fleet" component={PlatformConnectorFleet} />
            <Route path="/platform/catalogue" component={PlatformCataloguePage} />
            <Route path="/platform" component={PlatformDashboard} />
            {/* Legacy Sprint 0 routes */}
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/organizations" component={OrganizationsList} />
            <Route path="/organizations/:id" component={OrganizationDetail} />
            <Route path="/workforce" component={WorkforceBrowser} />
            <Route path="/system" component={SystemStatus} />
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ClerkErrorBoundary>
      <WouterRouter base={basePath}>
        <AppRouter />
      </WouterRouter>
    </ClerkErrorBoundary>
  );
}
export default App;
