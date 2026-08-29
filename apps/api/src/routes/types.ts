import type { ApiResult } from "@agentx/contracts";
import type { LocalDataGateway } from "@agentx/data-gateway";
import type { FileAssetService } from "@agentx/files";
import type { LocalKnowledgeService } from "@agentx/knowledge";
import type { MetadataStore } from "@agentx/metadata";
import type { RunCancelRegistry } from "../run-cancel-registry.js";

export type ConfigApiContext = {
  dataGateway: LocalDataGateway;
  fileAssetService: FileAssetService;
  knowledgeService: LocalKnowledgeService;
  metadataStore: MetadataStore;
  runCancelRegistry: RunCancelRegistry;
  userId: string;
  workspaceId?: string;
};

export type ConfigApiResponse = {
  body: ApiResult<unknown> | Buffer | Record<string, unknown>;
  headers?: Record<string, string>;
  status: number;
};
