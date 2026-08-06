/**
 * @deprecated Sprint 29C — LEGACY / DISCONNECTED
 *
 * This service was written before the Unified Execution Architecture and
 * implements a parallel execution pipeline that has been superseded by
 * `UnifiedExecutionEngine` (artifacts/api-server/src/services/unifiedExecutionEngine.ts).
 *
 * It has NO live callers — no route, orchestrator, or coordinator imports it.
 * It is retained here for historical reference ONLY.
 *
 * DO NOT reconnect this service. Any new execution path must enter through
 * UnifiedExecutionEngine. See the Sprint 29B.1 architecture report for details.
 *
 * ---
 *
 * End-to-End Mocked Workflow Demonstration — Sprint XX (ORIGINAL DESCRIPTION)
 *
 * Demonstrated the complete execution path:
 * User Task → CoS Analysis → Specialist Selected → Work Package →
 * Specialist Executes → Mock Connector Invoked → Output Contract →
 * CoS Consolidates → Audit Recorded → Response Ready
 *
 * Used for integration testing. No real LLM calls. No real connectors.
 */

import { randomUUID } from "crypto";
import {
  assembleRuntimeContext,
} from "./runtimeContextService.js";
import {
  createExecutionGraph,
  addGraphNode,
  updateNodeStatus,
  publishExecutionEvent,
} from "./organisationRuntimeService.js";
import {
  createEmptyContract,
  validateContract,
  contractToCoSPromptBlock,
} from "./specialistOutputContractService.js";
import {
  MOCK_CONNECTOR_REGISTRY,
} from "./connectorMockService.js";
import type { SpecialistWorkPackage } from "./specialistIntelligenceService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStageResult {
  stage: string;
  status: 'completed' | 'skipped' | 'failed';
  durationMs: number;
  output: Record<string, unknown>;
}

export interface EndToEndWorkflowResult {
  workflowId: string;
  organisationId: string;
  taskDescription: string;
  stages: WorkflowStageResult[];
  finalResponse: string;
  totalDurationMs: number;
  success: boolean;
  graphId?: string;
}

// ─── Stage Runner ─────────────────────────────────────────────────────────────

async function runStage(
  stages: WorkflowStageResult[],
  stageName: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  try {
    const output = await fn();
    stages.push({
      stage: stageName,
      status: 'completed',
      durationMs: Date.now() - start,
      output,
    });
    return output;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    stages.push({
      stage: stageName,
      status: 'failed',
      durationMs: Date.now() - start,
      output: { error: message },
    });
    throw err;
  }
}

// ─── Main Workflow ────────────────────────────────────────────────────────────

/**
 * Runs the complete mocked end-to-end workflow for a task.
 * All stages are recorded in the returned result.
 */
export async function runMockedWorkflow(
  organisationId: string,
  taskDescription: string,
  options?: { specialistRole?: string; useConnector?: boolean },
): Promise<EndToEndWorkflowResult> {
  const workflowId = randomUUID();
  const totalStart = Date.now();
  const stages: WorkflowStageResult[] = [];
  const specialistRole = options?.specialistRole ?? 'operations_manager';
  const useConnector = options?.useConnector ?? true;

  let graphId: string | undefined;
  let specialistRunNodeId: string | undefined;
  let connectorNodeId: string | undefined;
  let consolidationNodeId: string | undefined;
  let finalResponse = '';

  try {
    // ── Stage 1: Context Assembly ─────────────────────────────────────────────
    const contextOutput = await runStage(stages, 'context_assembly', async () => {
      const context = await assembleRuntimeContext(organisationId, 'chief_of_staff', {
        includeMemory: false,
      });
      return {
        organisationId: context.organisationId,
        orgName: context.identity.name,
        orgType: context.identity.type,
        timezone: context.identity.timezone,
        executionFrozen: context.runtimeState.executionFrozen,
        resourceCount: context.availableResources.length,
        connectorCount: context.connectors.filter((c) => c.available).length,
        configSummary: context.configuration
          ? `businessHours: ${context.configuration.businessHoursStart ?? '09:00'}–${context.configuration.businessHoursEnd ?? '17:00'}`
          : '(no configuration)',
      };
    });

    // Check if execution is frozen
    if (contextOutput.executionFrozen === true) {
      stages.push({
        stage: 'cos_analysis',
        status: 'skipped',
        durationMs: 0,
        output: { reason: 'Execution frozen for this organisation' },
      });
      return {
        workflowId,
        organisationId,
        taskDescription,
        stages,
        finalResponse: 'Execution is currently frozen for this organisation. No tasks can be processed.',
        totalDurationMs: Date.now() - totalStart,
        success: false,
      };
    }

    // ── Stage 2: CoS Analysis (static mock) ───────────────────────────────────
    const cosAnalysis = await runStage(stages, 'cos_analysis', async () => {
      // Static mock — no real LLM call
      const lowerTask = taskDescription.toLowerCase();
      const isFinanceTask = lowerTask.includes('invoice') || lowerTask.includes('account') || lowerTask.includes('payment') || lowerTask.includes('xero');
      const isStaffingTask = lowerTask.includes('roster') || lowerTask.includes('shift') || lowerTask.includes('timesheet') || lowerTask.includes('deputy');
      const isDocumentTask = lowerTask.includes('document') || lowerTask.includes('policy') || lowerTask.includes('file') || lowerTask.includes('report');

      const selectedSpecialist = specialistRole ?? (
        isFinanceTask ? 'finance_manager' :
        isStaffingTask ? 'staffing_coordinator' :
        'operations_manager'
      );

      return {
        conversationMode: 'task_intent',
        specialistRequired: true,
        selectedSpecialist,
        taskClassification: isFinanceTask ? 'finance' : isStaffingTask ? 'staffing' : isDocumentTask ? 'document' : 'general',
        urgency: 'normal',
        estimatedComplexity: 'moderate',
      };
    });

    // ── Stage 3: Work Package Creation ────────────────────────────────────────
    const workPackage = await runStage(stages, 'work_package_creation', async () => {
      // Mock work package — no DB insert
      const pkg: Partial<SpecialistWorkPackage> = {
        specialistRunId: randomUUID(),
        organizationId: organisationId,
        taskId: workflowId,
        capabilityCode: 'operations_management',
        capabilityLevel: 'professional_analysis',
        workforceRoleCode: cosAnalysis.selectedSpecialist as string,
        workerProfileCode: 'standard_analysis',
        objective: `Analyse and respond to: ${taskDescription}`,
        responsibilities: [
          'Review available organisational context',
          'Identify key findings relevant to the task',
          'Produce actionable recommendations',
          'Flag any approvals or blockers',
        ],
        expectedOutputs: [
          'Executive summary',
          'Findings list',
          'Recommendations list',
          'Execution intents (if applicable)',
        ],
        approvedOrganisationMemory: [],
        relevantConversationContext: [],
        taskContext: [],
        previousSpecialistOutputs: [],
        allowedCapabilities: ['operations_management'],
        allowedTools: ['analysis', 'document_review'],
        allowedConnectorCategories: ['file', 'api'],
        allowedExecutionChannels: ['connector'],
        prohibitedActions: ['Direct database access', 'Expose physical file paths'],
        approvalRequiredActions: ['Submit to external systems', 'Delete records'],
        dependencies: [],
        assumptions: ['Organisation context is accurate'],
        unresolvedQuestions: [],
        riskLevel: 'low',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };

      return {
        specialistRunId: pkg.specialistRunId,
        workforceRoleCode: pkg.workforceRoleCode,
        capabilityCode: pkg.capabilityCode,
        objective: pkg.objective,
        riskLevel: pkg.riskLevel,
        expiresAt: pkg.expiresAt,
      };
    });

    // ── Stage 4: Graph Creation ────────────────────────────────────────────────
    const graphData = await runStage(stages, 'graph_creation', async () => {
      const graph = await createExecutionGraph(organisationId, workflowId);
      graphId = graph.graphId;

      // Add specialist_run node
      const specialistRunNode = await addGraphNode(graph.graphId, {
        nodeType: 'specialist_run',
        status: 'pending',
        dependsOnNodeIds: [],
      });
      specialistRunNodeId = specialistRunNode.nodeId;

      // Add connector_call node (depends on specialist_run)
      const connectorNode = await addGraphNode(graph.graphId, {
        nodeType: 'connector_call',
        status: 'pending',
        dependsOnNodeIds: [specialistRunNode.nodeId],
      });
      connectorNodeId = connectorNode.nodeId;

      // Add consolidation node (depends on connector_call)
      const consolidationNode = await addGraphNode(graph.graphId, {
        nodeType: 'consolidation',
        status: 'pending',
        dependsOnNodeIds: [connectorNode.nodeId],
      });
      consolidationNodeId = consolidationNode.nodeId;

      return {
        graphId: graph.graphId,
        nodeCount: graph.nodes.length,
        status: graph.status,
        specialistRunNodeId,
        connectorNodeId,
        consolidationNodeId,
      };
    });

    // ── Stage 5: Specialist Execution ─────────────────────────────────────────
    if (specialistRunNodeId) {
      await updateNodeStatus(workflowId, specialistRunNodeId, 'active');
    }

    const specialistOutput = await runStage(stages, 'specialist_execution', async () => {
      // Static specialist run — no real LLM call
      const contract = createEmptyContract(
        cosAnalysis.selectedSpecialist as string,
        workflowId,
        (workPackage.specialistRunId as string) ?? randomUUID(),
        organisationId,
      );

      contract.summary = `Analysis of "${taskDescription}" has been completed. ` +
        `The task has been reviewed against organisational context and available resources. ` +
        `Recommendations are ready for review.`;

      contract.findings = [
        `Task "${taskDescription}" requires ${cosAnalysis.taskClassification} domain expertise`,
        `Organisation has ${contextOutput.resourceCount as number} registered resources available`,
        `Execution is permitted — no frozen state detected`,
        `Task complexity assessed as: ${cosAnalysis.estimatedComplexity}`,
      ];

      contract.recommendations = [
        `Proceed with ${cosAnalysis.taskClassification} workflow for this task`,
        `Review available resources before committing to execution`,
        `Escalate to human reviewer if execution scope expands beyond current parameters`,
      ];

      contract.evidenceReferences = [
        {
          resourceId: 'org-context',
          resourceName: 'Organisation Runtime Context',
          relevance: 'Provided organisational identity, timezone, and resource availability',
        },
      ];

      contract.executionIntents = [
        {
          intentId: randomUUID(),
          intentType: 'connector_query',
          description: `Query ${cosAnalysis.taskClassification} data via connector`,
          targetSystem: cosAnalysis.taskClassification === 'finance' ? 'xero_connector' : 'file_connector',
          priority: 'normal',
          requiresApproval: false,
          estimatedDuration: '< 30 seconds',
        },
      ];

      contract.confidence = 0.82;
      contract.completeness = 'complete';
      contract.durationMs = 245; // mock duration

      return {
        specialistRoleCode: contract.specialistRoleCode,
        summary: contract.summary,
        findingsCount: contract.findings.length,
        recommendationsCount: contract.recommendations.length,
        intentCount: contract.executionIntents.length,
        confidence: contract.confidence,
        completeness: contract.completeness,
        _contract: contract, // pass through for later stages
      };
    });

    if (specialistRunNodeId) {
      await updateNodeStatus(workflowId, specialistRunNodeId, 'completed', specialistOutput.summary as string);
    }

    // ── Stage 6: Connector Invocation ─────────────────────────────────────────
    if (connectorNodeId) {
      await updateNodeStatus(workflowId, connectorNodeId, 'active');
    }

    const connectorOutput = await runStage(stages, 'connector_invocation', async () => {
      if (!useConnector) {
        return { skipped: true, reason: 'useConnector option is false' };
      }

      const taskClass = cosAnalysis.taskClassification as string;

      if (taskClass === 'finance') {
        // Use MockApiConnector for finance tasks
        const apiConnector = MOCK_CONNECTOR_REGISTRY.api['xero_connector'];
        const result = await apiConnector.execute({
          operationId: randomUUID(),
          resourceId: 'xero',
          employeeRoleCode: cosAnalysis.selectedSpecialist as string,
          organisationId,
          connectorType: 'xero_connector',
          operation: 'get_invoices',
          payload: { limit: 5 },
        });
        return {
          connectorType: 'xero_connector',
          operation: 'get_invoices',
          success: result.success,
          dataPreview: Array.isArray((result.data as any)?.invoices)
            ? `${(result.data as any).invoices.length} invoices retrieved`
            : 'data received',
        };
      } else {
        // Use MockFileConnector for document/general tasks
        const fileConnector = MOCK_CONNECTOR_REGISTRY.file;
        const result = await fileConnector.search({
          operationId: randomUUID(),
          resourceId: 'policies',
          employeeRoleCode: cosAnalysis.selectedSpecialist as string,
          organisationId,
          connectorType: 'sharepoint_file_connector',
          operation: 'search',
          query: taskDescription.slice(0, 50),
        });
        return {
          connectorType: 'file_connector',
          operation: 'search',
          success: result.success,
          dataPreview: Array.isArray((result.data as any)?.items)
            ? `${(result.data as any).items.length} documents found`
            : 'data received',
        };
      }
    });

    if (connectorNodeId) {
      await updateNodeStatus(workflowId, connectorNodeId, 'completed', `Connector invoked: ${connectorOutput.connectorType ?? 'file_connector'}`);
    }

    // ── Stage 7: Output Contract Validation ───────────────────────────────────
    const validationOutput = await runStage(stages, 'output_contract_validation', async () => {
      const contract = (specialistOutput as any)._contract;
      const validation = validateContract(contract);
      return {
        valid: validation.valid,
        errorCount: validation.errors.length,
        errors: validation.errors,
      };
    });

    // ── Stage 8: CoS Consolidation ────────────────────────────────────────────
    if (consolidationNodeId) {
      await updateNodeStatus(workflowId, consolidationNodeId, 'active');
    }

    const consolidationOutput = await runStage(stages, 'cos_consolidation', async () => {
      const contract = (specialistOutput as any)._contract;
      const promptBlock = contractToCoSPromptBlock(contract);

      // Static CoS consolidation response — no real LLM call
      finalResponse = [
        `Task: ${taskDescription}`,
        '',
        `Specialist Analysis by ${cosAnalysis.selectedSpecialist as string}:`,
        contract.summary,
        '',
        `Key Findings (${contract.findings.length}):`,
        ...contract.findings.map((f: string) => `• ${f}`),
        '',
        `Recommendations (${contract.recommendations.length}):`,
        ...contract.recommendations.map((r: string) => `• ${r}`),
        '',
        `Confidence: ${Math.round(contract.confidence * 100)}%`,
        connectorOutput.skipped !== true
          ? `\nConnector Data: ${connectorOutput.dataPreview ?? 'retrieved successfully'}`
          : '',
        '',
        `Status: ${validationOutput.valid ? 'Contract validated ✓' : `Validation issues: ${(validationOutput.errors as string[]).join(', ')}`}`,
      ].filter((l) => l !== undefined).join('\n');

      return {
        promptBlockLength: promptBlock.length,
        finalResponseLength: finalResponse.length,
        consolidationComplete: true,
      };
    });

    if (consolidationNodeId) {
      await updateNodeStatus(workflowId, consolidationNodeId, 'completed', 'Consolidation complete');
    }

    // ── Stage 9: Audit Recording ───────────────────────────────────────────────
    await runStage(stages, 'audit_recording', async () => {
      await publishExecutionEvent({
        graphId: workflowId,
        taskId: workflowId,
        eventType: 'graph_completed',
        actorType: 'agent',
        actorId: 'chief_of_staff',
        organisationId,
        payload: {
          workflowId,
          specialistRole: cosAnalysis.selectedSpecialist,
          taskClassification: cosAnalysis.taskClassification,
          confidence: (specialistOutput as any)._contract?.confidence,
          stageCount: stages.length + 1, // +1 for this stage
        },
      });
      return {
        eventType: 'graph_completed',
        recorded: true,
      };
    });

    // ── Stage 10: Graph Completion ────────────────────────────────────────────
    await runStage(stages, 'graph_completion', async () => {
      // Mark all remaining pending nodes as completed
      const nodeIds = [specialistRunNodeId, connectorNodeId, consolidationNodeId].filter(Boolean) as string[];
      for (const nodeId of nodeIds) {
        await updateNodeStatus(workflowId, nodeId, 'completed');
      }

      return {
        graphId: workflowId,
        nodesCompleted: nodeIds.length,
        graphStatus: 'completed',
      };
    });

    return {
      workflowId,
      organisationId,
      taskDescription,
      stages,
      finalResponse,
      totalDurationMs: Date.now() - totalStart,
      success: true,
      graphId,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Mark graph as failed if we have one
    if (graphId && specialistRunNodeId) {
      try {
        await updateNodeStatus(workflowId, specialistRunNodeId, 'failed', message);
      } catch {
        // Best effort
      }
    }

    await publishExecutionEvent({
      graphId: workflowId,
      taskId: workflowId,
      eventType: 'graph_failed',
      actorType: 'system',
      organisationId,
      payload: { error: message, failedStage: stages[stages.length - 1]?.stage ?? 'unknown' },
    }).catch(() => {
      // Best effort — don't throw in error handler
    });

    return {
      workflowId,
      organisationId,
      taskDescription,
      stages,
      finalResponse: `Workflow failed: ${message}`,
      totalDurationMs: Date.now() - totalStart,
      success: false,
      graphId,
    };
  }
}
