import type {
  ConnectorType,
  FileConnectorOperation,
  BrowserConnectorOperation,
  ApiConnectorOperation,
  ConnectorResult,
} from "./types.js";

// ─── IFileConnector ────────────────────────────────────────────────────────────

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

// ─── IBrowserConnector ────────────────────────────────────────────────────────

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

// ─── IApiConnector ────────────────────────────────────────────────────────────

export interface IApiConnector {
  execute(op: ApiConnectorOperation): Promise<ConnectorResult>;
  getCapabilities(): string[];
  getSupportedOperations(): string[];
}

// ─── ConnectorFactory ─────────────────────────────────────────────────────────

export type ConnectorFactory = {
  createFileConnector(connectorType: ConnectorType): IFileConnector | null;
  createBrowserConnector(): IBrowserConnector;
  createApiConnector(connectorType: ConnectorType): IApiConnector | null;
};
