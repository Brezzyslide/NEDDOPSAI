import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CompletedWorkPortal from "../CompletedWorkPortal";
import CompletedWorkViewer from "../CompletedWorkViewer";
import TaskCentrePage from "../TaskCentrePage";
import TaskWorkroomPage from "../TaskWorkroomPage";

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

describe("care-plan UI end to end affordances", () => {
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
          approvalWorkflow: { approvalBlocked: true },
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
    await user.click(screen.getByRole("button", { name: "Download PDF artifact" }));
    await waitFor(() => expect(artifactDownloadCalls).toEqual([
      "/v1/organisations/mhr-holdings-pty-ltd/completed-work/work-1/artifacts/artifact-pdf/download",
    ]));
  });

  it("serialises a fresh participant care plan request only after a participant is selected", async () => {
    const user = userEvent.setup();
    const postRequests: Array<{ path: string; body: unknown }> = [];
    mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postRequests.push({ path, body: JSON.parse(String(init.body)) });
        return jsonResponse({ task: { id: `task-${postRequests.length}` }, reusedExisting: false }, 201);
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

    const createButton = await screen.findByRole("button", { name: "Create care plan" });
    expect(createButton).toBeDisabled();

    await user.selectOptions(await screen.findByLabelText("Participant"), "7bb35c11-83f2-4f2b-af01-38633ba1cfa0");
    expect(screen.getByText(/Bound participant ID:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create care plan" }));
    await waitFor(() => expect(postRequests).toHaveLength(1));

    await user.selectOptions(await screen.findByLabelText("Participant"), "7bb35c11-83f2-4f2b-af01-38633ba1cfa0");
    await user.click(screen.getByRole("button", { name: "Create care plan" }));
    await waitFor(() => expect(postRequests).toHaveLength(2));

    expect(postRequests).toEqual([
      {
        path: "/v1/organisations/mhr-holdings-pty-ltd/tasks",
        body: {
          title: "Create participant-specific care plan",
          description: "Create a participant-specific care plan.",
          priority: "normal",
          originatingModule: "task_centre_direct_care_plan",
          sourceUserRequest: "Create a participant-specific care plan.",
          allowDuplicate: true,
          subjectParticipantIds: ["7bb35c11-83f2-4f2b-af01-38633ba1cfa0"],
        },
      },
      {
        path: "/v1/organisations/mhr-holdings-pty-ltd/tasks",
        body: {
          title: "Create participant-specific care plan",
          description: "Create a participant-specific care plan.",
          priority: "normal",
          originatingModule: "task_centre_direct_care_plan",
          sourceUserRequest: "Create a participant-specific care plan.",
          allowDuplicate: true,
          subjectParticipantIds: ["7bb35c11-83f2-4f2b-af01-38633ba1cfa0"],
        },
      },
    ]);
  });

  it("renders workroom state and the concrete plan steps returned by the workroom payload", async () => {
    mocks.routeParams = { slug: "mhr-holdings-pty-ltd", taskId: "task-1" };
    const requestedPaths: string[] = [];
    mocks.apiFetch.mockImplementation(async (path: string) => {
      requestedPaths.push(path);
      return jsonResponse({
        task: {
          id: "task-1",
          title: "Create care plan",
          description: "Participant care plan",
          currentState: "executing",
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

    expect(await screen.findByText(/Executing/)).toBeInTheDocument();
    expect(screen.getByText("Gather participant evidence")).toBeInTheDocument();
    expect(screen.getByText("Draft care plan")).toBeInTheDocument();
    expect(requestedPaths).toEqual([
      "/v1/organisations/mhr-holdings-pty-ltd/tasks/task-1/workroom",
    ]);
  });
});
