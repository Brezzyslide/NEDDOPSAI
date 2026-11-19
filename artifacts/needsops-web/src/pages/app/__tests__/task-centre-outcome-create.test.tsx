import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CompletedWorkPortal from "../CompletedWorkPortal";
import CompletedWorkViewer from "../CompletedWorkViewer";
import TaskCentrePage from "../TaskCentrePage";
import TaskWorkroomPage, { shouldPollWorkroom } from "../TaskWorkroomPage";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  routeParams: {} as Record<string, string>,
  setLocation: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  useAuthFetch: () => mocks.apiFetch,
}));

vi.mock("@clerk/react", () => ({
  Show: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("wouter", () => ({
  useParams: () => mocks.routeParams,
  useLocation: () => ["/app/mhr-holdings-pty-ltd/tasks", mocks.setLocation] as const,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/layout/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useOrgRole", () => ({
  useOrgRole: () => ({ canApprove: true }),
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <article>{content}</article>,
  extractOutline: () => [],
}));

vi.mock("@/components/inspector/ExecutionInspectorPanel", () => ({
  default: () => <div data-testid="execution-inspector" />,
}));

vi.mock("@/components/workroom/SpecialistRunsPanel", () => ({
  default: () => <div data-testid="specialist-runs" />,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.setLocation.mockReset();
  mocks.routeParams = { slug: "mhr-holdings-pty-ltd" };
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("task centre outcome create affordances", () => {
  it("renders stored artifact download controls in the completed work portal for evidence_required work", async () => {
    const user = userEvent.setup();
    const artifactDownloadCalls: string[] = [];
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.includes("/artifacts/")) {
        artifactDownloadCalls.push(path);
        return jsonResponse({ downloadUrl: "https://download.example/care-plan.docx" });
      }
      return jsonResponse({
        completedWork: [{
          id: "work-1",
          title: "Care Plan Draft",
          outputType: "plan",
          primarySpecialist: "chief_of_staff",
          status: "evidence_required",
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
          blueprintId: null,
          conversationId: null,
          createdByUserId: null,
          approvedByUserId: null,
          approvalWorkflow: { approvalBlocked: true },
          generatedArtifacts: [
            { id: "artifact-docx", artifactType: "primary_deliverable", fileFormat: "docx", generationStatus: "stored" },
            { id: "artifact-pdf", artifactType: "secondary_deliverable", fileFormat: "pdf", generationStatus: "stored" },
          ],
        }],
      });
    });

    renderWithClient(<CompletedWorkPortal />);

    expect(await screen.findByText("Care Plan Draft")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download Word artifact" }));
    await waitFor(() => expect(artifactDownloadCalls).toEqual([
      "/v1/organisations/mhr-holdings-pty-ltd/completed-work/work-1/artifacts/artifact-docx/download",
    ]));
    expect(screen.getByRole("button", { name: "Download PDF artifact" })).toBeInTheDocument();
  });

  it("renders stored artifact download controls in the completed work viewer for evidence_required work", async () => {
    const user = userEvent.setup();
    mocks.routeParams = { slug: "mhr-holdings-pty-ltd", id: "work-1" };
    const artifactDownloadCalls: string[] = [];
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/versions")) return jsonResponse({ versions: [{ id: "v1", versionNumber: 1, content: "Care plan body", createdAt: "2026-11-01T00:00:00.000Z" }] });
      if (path.endsWith("/comments")) return jsonResponse({ comments: [] });
      if (path.includes("/artifacts/")) {
        artifactDownloadCalls.push(path);
        return jsonResponse({ downloadUrl: "https://download.example/care-plan.pdf" });
      }
      return jsonResponse({
        completedWork: {
          id: "work-1",
          title: "Care Plan Draft",
          outputType: "plan",
          primarySpecialist: "chief_of_staff",
          status: "evidence_required",
          approvalWorkflow: {
            approvalBlocked: true,
            completionGateFailures: [{ gate: "generation_truncation", message: "Mobility output was truncated." }],
            metadataOnlyCompletionFindings: [{ gate: "document_metadata", message: "Review date was inferred." }],
            suppressedClaims: [{ section: "Mobility", claim: "Independent transfers", reason: "No cited evidence." }],
          },
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
        assets: [],
        generatedArtifacts: [
          { id: "artifact-docx", artifactType: "primary_deliverable", fileFormat: "docx", generationStatus: "stored", fileSize: 1024, createdAt: "2026-11-01T00:00:00.000Z" },
          { id: "artifact-pdf", artifactType: "secondary_deliverable", fileFormat: "pdf", generationStatus: "stored", fileSize: 1024, createdAt: "2026-11-01T00:00:00.000Z" },
        ],
      });
    });

    renderWithClient(<CompletedWorkViewer />);

    expect(await screen.findByRole("button", { name: "Download DOCX artifact" })).toBeInTheDocument();
    expect(screen.getByText("Completion checks")).toBeInTheDocument();
    expect(screen.getByText(/Mobility output was truncated/)).toBeInTheDocument();
    expect(screen.getByText("Metadata findings")).toBeInTheDocument();
    expect(screen.getByText(/Review date was inferred/)).toBeInTheDocument();
    expect(screen.getByText("Suppressed unsupported claims")).toBeInTheDocument();
    expect(screen.getByText(/Independent transfers/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download PDF artifact" }));
    await waitFor(() => expect(artifactDownloadCalls).toEqual([
      "/v1/organisations/mhr-holdings-pty-ltd/completed-work/work-1/artifacts/artifact-pdf/download",
    ]));
  });

  it("renders outcome requirements from backend-resolved fixtures and serialises only the selected intent", async () => {
    const user = userEvent.setup();
    const postRequests: Array<{ path: string; body: unknown }> = [];
    mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postRequests.push({ path, body: JSON.parse(String(init.body)) });
        return jsonResponse({ task: { id: `task-${postRequests.length}` }, reusedExisting: false }, 201);
      }
      if (path.endsWith("/work-blueprints")) {
        return jsonResponse({
          blueprints: [
            {
              id: "blueprint-care-plan-primary",
              code: "care_plan",
              title: "Participant Care Plan",
              family: "participant_support",
              purpose: "Create a participant support plan.",
              canonicalIntent: "care_plan.create",
              outcomeLabel: "Care Plan",
              requiresParticipant: true,
              composesWith: ["blueprint-care-plan-companion"],
              requiredEvidenceCategories: ["ndis_plan"],
            },
            {
              id: "blueprint-care-plan-duplicate-mode",
              code: "care_plan_alt",
              title: "Care Plan Alternate Mode",
              canonicalIntent: "care_plan.create",
              outcomeLabel: "Care Plan Duplicate",
              requiresParticipant: true,
              composesWith: [],
              requiredEvidenceCategories: ["service_agreement"],
            },
            {
              id: "blueprint-policy-summary",
              code: "policy_summary",
              title: "Policy Summary",
              canonicalIntent: "policy.summary.create",
              outcomeLabel: "Policy Summary",
              requiresParticipant: false,
              composesWith: [],
              requiredEvidenceCategories: ["controlled_document"],
            },
            {
              id: "blueprint-without-outcome",
              code: "internal_blueprint",
              title: "Internal Blueprint",
              canonicalIntent: "internal.blueprint.create",
              outcomeLabel: null,
              requiresParticipant: false,
              composesWith: [],
              requiredEvidenceCategories: [],
            },
          ],
        });
      }
      if (path.endsWith("/work-blueprints/outcomes/care_plan.create")) {
        return jsonResponse({
          outcome: {
            canonicalIntent: "care_plan.create",
            outcomeLabel: "Care Plan",
            requiresParticipant: true,
            requiredEvidenceCategories: ["ndis_plan", "service_agreement"],
            blueprintSet: [
              { id: "blueprint-care-plan-primary", code: "care_plan", title: "Participant Care Plan", family: "participant_support", canonicalIntent: "care_plan.create", outcomeLabel: "Care Plan", requiresParticipant: true, composesWith: ["blueprint-care-plan-companion"], requiredEvidenceCategories: ["ndis_plan"] },
              { id: "blueprint-care-plan-companion", code: "service_context", title: "Service Context", family: "participant_support", canonicalIntent: null, outcomeLabel: null, requiresParticipant: true, composesWith: [], requiredEvidenceCategories: ["service_agreement"] },
            ],
          },
        });
      }
      if (path.endsWith("/work-blueprints/outcomes/policy.summary.create")) {
        return jsonResponse({
          outcome: {
            canonicalIntent: "policy.summary.create",
            outcomeLabel: "Policy Summary",
            requiresParticipant: false,
            requiredEvidenceCategories: ["controlled_document"],
            blueprintSet: [
              { id: "blueprint-policy-summary", code: "policy_summary", title: "Policy Summary", family: "policy", canonicalIntent: "policy.summary.create", outcomeLabel: "Policy Summary", requiresParticipant: false, composesWith: [], requiredEvidenceCategories: ["controlled_document"] },
            ],
          },
        });
      }
      if (path.endsWith("/participants?limit=200")) {
        return jsonResponse({
          participants: [
            { id: "7bb35c11-83f2-4f2b-af01-38633ba1cfa0", displayName: "Michael Roberts", externalParticipantId: "MR-001" },
            { id: "92a1df0e-a7f0-4633-afb9-7e905f8ce111", displayName: "Different Participant" },
          ],
        });
      }
      return jsonResponse({ tasks: [] });
    });

    renderWithClient(<TaskCentrePage />);

    expect(screen.queryByRole("button", { name: "+ New Task" })).not.toBeInTheDocument();
    expect(screen.queryByText("Create New Task")).not.toBeInTheDocument();

    const createButton = await screen.findByRole("button", { name: "Create" });
    expect(createButton).toBeDisabled();
    expect(await screen.findByRole("option", { name: "Care Plan" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Policy Summary" })).toBeInTheDocument();
    expect(screen.queryByText("Internal Blueprint")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Care Plan Duplicate" })).not.toBeInTheDocument();

    await user.selectOptions(await screen.findByLabelText("Outcome"), "policy.summary.create");
    expect(await screen.findByText("Controlled Document")).toBeInTheDocument();
    expect(screen.queryByLabelText("Participant")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(postRequests).toHaveLength(1));

    await user.selectOptions(await screen.findByLabelText("Outcome"), "care_plan.create");
    expect(await screen.findByText("NDIS plan")).toBeInTheDocument();
    expect(screen.getByText("Service agreement")).toBeInTheDocument();
    expect(screen.getByText("Service Context")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await user.selectOptions(await screen.findByLabelText("Participant"), "7bb35c11-83f2-4f2b-af01-38633ba1cfa0");
    expect(screen.getByText(/Bound participant ID:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(postRequests).toHaveLength(2));

    expect(postRequests).toEqual([
      {
        path: "/v1/organisations/mhr-holdings-pty-ltd/tasks",
        body: {
          title: "Create Policy Summary",
          description: "Create Policy Summary.",
          priority: "normal",
          originatingModule: "task_centre_outcome_create",
          sourceUserRequest: "Create Policy Summary.",
          outcomeCanonicalIntent: "policy.summary.create",
          allowDuplicate: true,
        },
      },
      {
        path: "/v1/organisations/mhr-holdings-pty-ltd/tasks",
        body: {
          title: "Create Care Plan",
          description: "Create Care Plan.",
          priority: "normal",
          originatingModule: "task_centre_outcome_create",
          sourceUserRequest: "Create Care Plan.",
          outcomeCanonicalIntent: "care_plan.create",
          allowDuplicate: true,
          subjectParticipantIds: ["7bb35c11-83f2-4f2b-af01-38633ba1cfa0"],
        },
      },
    ]);
  });

  it("renders workroom state and concrete plan steps without polling terminal tasks", async () => {
    mocks.routeParams = { slug: "mhr-holdings-pty-ltd", taskId: "task-1" };
    const requestedPaths: string[] = [];
    mocks.apiFetch.mockImplementation(async (path: string) => {
      requestedPaths.push(path);
      return jsonResponse({
        task: {
          id: "task-1",
          title: "Create care plan",
          description: "Participant care plan",
          currentState: "evidence_required",
          priority: "normal",
          approvalState: "not_required",
          createdAt: "2026-11-01T00:00:00.000Z",
        },
        plan: {
          planId: "plan-1",
          taskTitle: "Create care plan",
          primarySpecialist: "chief_of_staff",
          assignedSpecialists: ["chief_of_staff"],
          steps: [
            { stepNumber: 1, specialistCode: "chief_of_staff", specialistName: "Chief of Staff", action: "Gather participant evidence", estimatedDuration: "2 minutes", requiresApproval: false },
            { stepNumber: 2, specialistCode: "document_specialist", specialistName: "Document Specialist", action: "Draft care plan", estimatedDuration: "5 minutes", requiresApproval: false },
          ],
          estimatedTotalDuration: "7 minutes",
          requiresApproval: false,
          approvalType: "none",
          reasoning: "Direct care-plan task",
          confidence: 0.9,
        },
        pendingApproval: null,
        completedWork: [],
        messages: [],
        providerContribution: { enabled: false, subjectParticipantIds: [] },
      });
    });

    renderWithClient(<TaskWorkroomPage />);

    expect(await screen.findByText(/Evidence Required/)).toBeInTheDocument();
    expect(screen.getByText("Gather participant evidence")).toBeInTheDocument();
    expect(screen.getByText("Draft care plan")).toBeInTheDocument();
    expect(requestedPaths).toEqual([
      "/v1/organisations/mhr-holdings-pty-ltd/tasks/task-1/workroom",
    ]);
    expect(shouldPollWorkroom("evidence_required")).toBe(false);
    expect(shouldPollWorkroom("failed")).toBe(false);
    expect(shouldPollWorkroom("completed")).toBe(false);
    expect(shouldPollWorkroom("executing")).toBe(true);
  });
});
