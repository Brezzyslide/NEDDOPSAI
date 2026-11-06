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
});

describe("care-plan UI end to end affordances", () => {
  it("renders stored artifact download controls in the completed work portal for evidence_required work", async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({
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
    }));

    renderWithClient(<CompletedWorkPortal />);

    expect(await screen.findByText("Care Plan Draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Word artifact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF artifact" })).toBeInTheDocument();
  });

  it("renders stored artifact download controls in the completed work viewer for evidence_required work", async () => {
    mocks.routeParams = { slug: "mhr-holdings-pty-ltd", id: "work-1" };
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/versions")) return jsonResponse({ versions: [{ id: "v1", versionNumber: 1, content: "Care plan body", createdAt: "2026-11-01T00:00:00.000Z" }] });
      if (path.endsWith("/comments")) return jsonResponse({ comments: [] });
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
    expect(screen.getByRole("button", { name: "Download PDF artifact" })).toBeInTheDocument();
  });

  it("creates a fresh participant care plan task with allowDuplicate and a bound participant id every time", async () => {
    const user = userEvent.setup();
    const postBodies: unknown[] = [];
    mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postBodies.push(JSON.parse(String(init.body)));
        return jsonResponse({ task: { id: `task-${postBodies.length}` }, reusedExisting: false }, 201);
      }
      return jsonResponse({ tasks: [] });
    });

    renderWithClient(<TaskCentrePage />);

    const participantInput = await screen.findByPlaceholderText("Paste participant id");
    await user.type(participantInput, "7bb35c11-83f2-4f2b-af01-38633ba1cfa0");
    await user.click(screen.getByRole("button", { name: "Create care plan" }));
    await waitFor(() => expect(postBodies).toHaveLength(1));

    await user.clear(participantInput);
    await user.type(participantInput, "7bb35c11-83f2-4f2b-af01-38633ba1cfa0");
    await user.click(screen.getByRole("button", { name: "Create care plan" }));
    await waitFor(() => expect(postBodies).toHaveLength(2));

    expect(postBodies).toEqual([
      expect.objectContaining({
        allowDuplicate: true,
        subjectParticipantIds: ["7bb35c11-83f2-4f2b-af01-38633ba1cfa0"],
      }),
      expect.objectContaining({
        allowDuplicate: true,
        subjectParticipantIds: ["7bb35c11-83f2-4f2b-af01-38633ba1cfa0"],
      }),
    ]);
  });

  it("renders workroom state and the concrete plan steps returned by the workroom payload", async () => {
    mocks.routeParams = { slug: "mhr-holdings-pty-ltd", taskId: "task-1" };
    mocks.apiFetch.mockResolvedValue(jsonResponse({
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
    }));

    renderWithClient(<TaskWorkroomPage />);

    expect(await screen.findByText(/Executing/)).toBeInTheDocument();
    expect(screen.getByText("Gather participant evidence")).toBeInTheDocument();
    expect(screen.getByText("Draft care plan")).toBeInTheDocument();
  });
});
