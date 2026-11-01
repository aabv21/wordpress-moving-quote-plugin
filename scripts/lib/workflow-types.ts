export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  webhookId?: string;
  notes?: string;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
}

export interface WorkflowJson {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: unknown;
  settings: unknown;
  pinData?: unknown;
  meta?: { instanceId?: string };
  versionId?: string;
  staticData?: unknown;
  [key: string]: unknown;
}
