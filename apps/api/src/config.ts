import { createEnvConfig } from "@agentx/contracts";

export type ApiConfig = {
  host: string;
  port: number;
};

export const loadApiConfig = (): ApiConfig => createEnvConfig(process.env).api;
