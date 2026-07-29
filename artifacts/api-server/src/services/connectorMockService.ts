/**
 * Mock connector implementations for end-to-end testing.
 * These satisfy the connector interfaces and allow full workflow testing without real systems.
 *
 * Sprint XX: These mocks will be replaced by real connector implementations in subsequent sprints.
 *
 * Connector interface definitions mirror @workspace/organisation-resource IFileConnector,
 * IBrowserConnector, and IApiConnector. They are defined inline here to avoid
 * requiring the @workspace/organisation-resource path alias in the api-server tsconfig
 * (that wiring is deferred to a subsequent sprint).
 */

import { randomUUID } from "crypto";

// ─── Connector Operation Types (mirrors @workspace/organisation-resource) ─────

export interface ConnectorOperation {
  operationId: string;
  resourceId: string;
  employeeRoleCode: string;
  organisationId: string;
  taskId?: string;
}

export interface FileConnectorOperation extends ConnectorOperation {
  connectorType:
    | 'file_connector'
    | 'sharepoint_file_connector'
    | 'onedrive_file_connector'
    | 'google_drive_connector'
    | 'dropbox_connector'
    | 'local_file_connector'
    | 'network_drive_connector';
  operation:
    | 'search'
    | 'locate'
    | 'open'
    | 'read'
    | 'write'
    | 'copy'
    | 'move'
    | 'delete'
    | 'metadata'
    | 'watch';
  query?: string;
  content?: string;
}

export interface BrowserConnectorOperation extends ConnectorOperation {
  connectorType: 'browser_connector';
  operation:
    | 'openBrowser'
    | 'login'
    | 'navigate'
    | 'click'
    | 'type'
    | 'upload'
    | 'download'
    | 'captureScreenshot'
    | 'extractContent'
    | 'logout'
    | 'close';
  targetUrl?: string;
  selector?: string;
  value?: string;
  executionRuntime: 'OpenClaw';
}

export interface ApiConnectorOperation extends ConnectorOperation {
  connectorType:
    | 'microsoft_graph_connector'
    | 'google_workspace_connector'
    | 'xero_connector'
    | 'deputy_connector'
    | 'employment_hero_connector'
    | 'lumary_connector'
    | 'shiftcare_connector'
    | 'generic_api_connector';
  operation: string;
  payload?: Record<string, unknown>;
}

export interface ConnectorResult {
  operationId: string;
  success: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  executedAt: string;
  auditRecordId?: string;
}

// ─── Connector Interfaces (mirrors @workspace/organisation-resource) ──────────

export interface IFileConnector {
  search(op: FileConnectorOperation): Promise<ConnectorResult>;
  locate(op: FileConnectorOperation): Promise<ConnectorResult>;
  open(op: FileConnectorOperation): Promise<ConnectorResult>;
  read(op: FileConnectorOperation): Promise<ConnectorResult>;
  write(op: FileConnectorOperation): Promise<ConnectorResult>;
  copy(op: FileConnectorOperation): Promise<ConnectorResult>;
  move(op: FileConnectorOperation): Promise<ConnectorResult>;
  delete(op: FileConnectorOperation): Promise<ConnectorResult>;
  metadata(op: FileConnectorOperation): Promise<ConnectorResult>;
  watch(op: FileConnectorOperation): Promise<ConnectorResult>;
}

export interface IBrowserConnector {
  openBrowser(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  login(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  navigate(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  click(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  type(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  upload(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  download(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  captureScreenshot(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  extractContent(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  logout(op: BrowserConnectorOperation): Promise<ConnectorResult>;
  close(op: BrowserConnectorOperation): Promise<ConnectorResult>;
}

export interface IApiConnector {
  execute(op: ApiConnectorOperation): Promise<ConnectorResult>;
  getCapabilities(): string[];
  getSupportedOperations(): string[];
}

// ─── Mock File Connector ──────────────────────────────────────────────────────

export class MockFileConnector implements IFileConnector {
  private makeResult(data: unknown, operationId?: string): ConnectorResult {
    return {
      operationId: operationId ?? randomUUID(),
      success: true,
      data,
      executedAt: new Date().toISOString(),
    };
  }

  async search(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] search — query: "${op.query ?? ''}" on resource: ${op.resourceId}`);
    return this.makeResult({
      items: [
        { fileId: 'mock-file-001', name: 'Policy Manual v3.pdf', type: 'document', size: 204800 },
        { fileId: 'mock-file-002', name: 'Staff Handbook 2024.docx', type: 'document', size: 98304 },
        { fileId: 'mock-file-003', name: 'Incident Report Template.xlsx', type: 'spreadsheet', size: 45056 },
      ],
      totalCount: 3,
      query: op.query ?? '',
    }, op.operationId);
  }

  async locate(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] locate — resource: ${op.resourceId}`);
    return this.makeResult({
      resourceId: op.resourceId,
      accessible: true,
      // physicalLocation intentionally omitted — never exposed
      note: 'Mock location resolved via resource registry',
    }, op.operationId);
  }

  async open(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] open — resource: ${op.resourceId}`);
    return this.makeResult({
      fileId: op.resourceId,
      opened: true,
      sessionToken: `mock-session-${randomUUID().slice(0, 8)}`,
      mimeType: 'application/pdf',
    }, op.operationId);
  }

  async read(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] read — resource: ${op.resourceId}`);
    return this.makeResult({
      content: `This is mock document content for resource "${op.resourceId}". ` +
        `In a real environment, this would contain the actual document text extracted from the connected system.`,
      encoding: 'utf-8',
      wordCount: 42,
      pageCount: 1,
    }, op.operationId);
  }

  async write(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] write — resource: ${op.resourceId}, contentLength: ${op.content?.length ?? 0}`);
    return this.makeResult({
      written: true,
      resourceId: op.resourceId,
      bytesWritten: op.content?.length ?? 0,
      version: `v${Date.now()}`,
    }, op.operationId);
  }

  async copy(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] copy — resource: ${op.resourceId}`);
    return this.makeResult({
      copied: true,
      sourceResourceId: op.resourceId,
      newResourceId: `mock-copy-${randomUUID().slice(0, 8)}`,
    }, op.operationId);
  }

  async move(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] move — resource: ${op.resourceId}`);
    return this.makeResult({
      moved: true,
      resourceId: op.resourceId,
    }, op.operationId);
  }

  async delete(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] delete — resource: ${op.resourceId}`);
    return this.makeResult({
      deleted: true,
      resourceId: op.resourceId,
    }, op.operationId);
  }

  async metadata(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] metadata — resource: ${op.resourceId}`);
    return this.makeResult({
      resourceId: op.resourceId,
      name: `mock-document-${op.resourceId}.pdf`,
      mimeType: 'application/pdf',
      size: 204800,
      createdAt: '2024-01-15T09:00:00.000Z',
      modifiedAt: new Date().toISOString(),
      owner: 'mock-owner',
      permissions: ['read', 'write'],
    }, op.operationId);
  }

  async watch(op: FileConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockFileConnector] watch — resource: ${op.resourceId}`);
    return this.makeResult({
      subscribed: true,
      resourceId: op.resourceId,
      subscriptionId: `mock-watch-${randomUUID().slice(0, 8)}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, op.operationId);
  }
}

// ─── Mock Browser Connector ───────────────────────────────────────────────────

export class MockBrowserConnector implements IBrowserConnector {
  private makeResult(data: unknown, operationId?: string): ConnectorResult {
    return {
      operationId: operationId ?? randomUUID(),
      success: true,
      data,
      executedAt: new Date().toISOString(),
    };
  }

  async openBrowser(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] openBrowser — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      browserId: `mock-browser-${randomUUID().slice(0, 8)}`,
      status: 'open',
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async login(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] login — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      sessionId: 'mock-session-001',
      loggedIn: true,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async navigate(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] navigate — url: ${op.targetUrl ?? '(none)'} — OpenClaw wiring pending`);
    return this.makeResult({
      url: op.targetUrl ?? 'about:blank',
      title: 'Mock Page',
      statusCode: 200,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async click(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] click — selector: ${op.selector ?? '(none)'} — OpenClaw wiring pending`);
    return this.makeResult({
      clicked: true,
      selector: op.selector,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async type(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] type — selector: ${op.selector ?? '(none)'} — OpenClaw wiring pending`);
    return this.makeResult({
      typed: true,
      selector: op.selector,
      length: op.value?.length ?? 0,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async upload(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] upload — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      uploaded: true,
      fileId: `mock-upload-${randomUUID().slice(0, 8)}`,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async download(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] download — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      downloaded: true,
      downloadId: `mock-download-${randomUUID().slice(0, 8)}`,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async captureScreenshot(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] captureScreenshot — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      screenshotId: 'mock-screenshot-001',
      format: 'png',
      width: 1920,
      height: 1080,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async extractContent(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] extractContent — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      content: 'Mock extracted content from the current browser page.',
      wordCount: 42,
      elementCount: 12,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async logout(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] logout — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      loggedOut: true,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }

  async close(op: BrowserConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockBrowserConnector] close — Mock browser operation — OpenClaw wiring pending`);
    return this.makeResult({
      closed: true,
      note: 'Mock browser operation — OpenClaw wiring pending',
    }, op.operationId);
  }
}

// ─── Mock API Connector ───────────────────────────────────────────────────────

const KNOWN_OPERATIONS: Record<string, string[]> = {
  xero_connector: [
    'get_invoices', 'create_invoice', 'update_invoice',
    'get_accounts', 'get_contacts', 'create_contact',
    'get_payments', 'create_payment',
    'get_bank_transactions', 'get_balance_sheet',
    'get_profit_and_loss',
  ],
  microsoft_graph_connector: [
    'get_calendar_events', 'create_calendar_event', 'update_calendar_event',
    'send_email', 'get_emails', 'get_contacts',
    'get_users', 'get_teams', 'get_channels',
    'get_sharepoint_sites', 'get_sharepoint_files',
  ],
  deputy_connector: [
    'get_rosters', 'create_roster', 'update_roster',
    'get_timesheets', 'approve_timesheet',
    'get_employees', 'get_locations',
    'get_leave_requests', 'approve_leave_request',
  ],
  employment_hero_connector: [
    'get_employees', 'get_payroll', 'get_leave_balances',
    'get_work_histories', 'get_performance_reviews',
  ],
  lumary_connector: [
    'get_participants', 'get_service_agreements',
    'get_support_items', 'create_support_note',
    'get_incidents', 'create_incident_report',
  ],
  shiftcare_connector: [
    'get_clients', 'get_shifts', 'create_shift',
    'get_staff', 'get_documents',
    'get_goals', 'create_shift_note',
  ],
  google_workspace_connector: [
    'get_calendar_events', 'create_calendar_event',
    'send_email', 'get_drive_files',
    'get_contacts', 'get_users',
  ],
  generic_api_connector: [
    'get', 'post', 'put', 'patch', 'delete',
  ],
};

export class MockApiConnector implements IApiConnector {
  constructor(private readonly connectorType: string) {}

  async execute(op: ApiConnectorOperation): Promise<ConnectorResult> {
    console.info(`[MockApiConnector:${this.connectorType}] execute — operation: ${op.operation}`);

    const mockData = this.buildMockResponse(op.operation, op.payload);

    return {
      operationId: op.operationId,
      success: true,
      data: mockData,
      executedAt: new Date().toISOString(),
    };
  }

  getCapabilities(): string[] {
    return KNOWN_OPERATIONS[this.connectorType] ?? ['execute'];
  }

  getSupportedOperations(): string[] {
    return this.getCapabilities();
  }

  private buildMockResponse(operation: string, payload?: Record<string, unknown>): Record<string, unknown> {
    // Connector-specific mock responses
    if (this.connectorType === 'xero_connector') {
      if (operation === 'get_invoices') {
        return {
          invoices: [
            { id: 'inv-001', number: 'INV-2024-001', amount: 1250.00, status: 'AUTHORISED', dueDate: '2024-02-15' },
            { id: 'inv-002', number: 'INV-2024-002', amount: 875.50, status: 'DRAFT', dueDate: '2024-02-28' },
          ],
          total: 2,
        };
      }
      if (operation === 'get_accounts') {
        return {
          accounts: [
            { id: 'acc-001', code: '090', name: 'Bank Account', type: 'BANK', balance: 45230.75 },
            { id: 'acc-002', code: '200', name: 'Trade Debtors', type: 'CURRENT', balance: 12450.00 },
          ],
        };
      }
    }

    if (this.connectorType === 'microsoft_graph_connector') {
      if (operation === 'get_calendar_events') {
        return {
          events: [
            { id: 'evt-001', subject: 'Team Standup', start: '2024-02-01T09:00:00Z', end: '2024-02-01T09:30:00Z' },
            { id: 'evt-002', subject: 'Client Review', start: '2024-02-01T14:00:00Z', end: '2024-02-01T15:00:00Z' },
          ],
        };
      }
      if (operation === 'send_email') {
        return { sent: true, messageId: `mock-msg-${randomUUID().slice(0, 8)}` };
      }
    }

    if (this.connectorType === 'deputy_connector') {
      if (operation === 'get_rosters') {
        return {
          rosters: [
            { id: 'ros-001', employeeId: 'emp-001', date: '2024-02-01', startTime: '08:00', endTime: '16:00' },
            { id: 'ros-002', employeeId: 'emp-002', date: '2024-02-01', startTime: '12:00', endTime: '20:00' },
          ],
        };
      }
      if (operation === 'get_timesheets') {
        return {
          timesheets: [
            { id: 'ts-001', employeeId: 'emp-001', hours: 8.0, date: '2024-01-31', status: 'PENDING' },
          ],
        };
      }
    }

    // Default mock response for unknown operations
    return {
      operation,
      connectorType: this.connectorType,
      mockResponse: true,
      data: payload ?? {},
      note: `Mock API response for ${this.connectorType}.${operation}`,
      requestedAt: new Date().toISOString(),
    };
  }
}

// ─── Factory Functions ────────────────────────────────────────────────────────

export function createMockFileConnector(): MockFileConnector {
  return new MockFileConnector();
}

export function createMockBrowserConnector(): MockBrowserConnector {
  return new MockBrowserConnector();
}

export function createMockApiConnector(connectorType: string): MockApiConnector {
  return new MockApiConnector(connectorType);
}

// ─── Connector Registry ───────────────────────────────────────────────────────

export const MOCK_CONNECTOR_REGISTRY: {
  file: MockFileConnector;
  browser: MockBrowserConnector;
  api: Record<string, MockApiConnector>;
} = {
  file: new MockFileConnector(),
  browser: new MockBrowserConnector(),
  api: {
    xero_connector: new MockApiConnector('xero_connector'),
    microsoft_graph_connector: new MockApiConnector('microsoft_graph_connector'),
    deputy_connector: new MockApiConnector('deputy_connector'),
    employment_hero_connector: new MockApiConnector('employment_hero_connector'),
    lumary_connector: new MockApiConnector('lumary_connector'),
    shiftcare_connector: new MockApiConnector('shiftcare_connector'),
    google_workspace_connector: new MockApiConnector('google_workspace_connector'),
    generic_api_connector: new MockApiConnector('generic_api_connector'),
  },
};
