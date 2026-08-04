export type ResourceGuideResource = {
  id: string;
  title: string;
  url: string;
  category: string;
  dateAdded: string;
  disciplines: string[];
  researchStages: string[];
  aiRoles: string[];
  tags: string[];
  resourceType?: string;
  source?: string;
  creator?: string;
  publishedDate?: string;
  description?: string;
  publicAnnotation?: string;
};

export type ResourceGuideResponse = {
  resources: ResourceGuideResource[];
  generatedAt: string;
};

export type ResourceGuideManifest = {
  currentKey: string;
  fetchedAt: string;
};

export type ResourceGuideLoadResult = {
  response: ResourceGuideResponse;
  etag: string;
  stale: boolean;
};

export type ResourceGuideStore = {
  get(key: string, options: { type: "json" }): Promise<unknown>;
  set(key: string, value: string): Promise<void>;
  setJSON(key: string, value: unknown): Promise<void>;
};

export type ResourceGuideNotionClient = {
  databases: {
    retrieve(args: { database_id: string }): Promise<unknown>;
  };
  dataSources: {
    query(args: Record<string, unknown>): Promise<{
      results: unknown[];
      has_more: boolean;
      next_cursor: string | null;
    }>;
  };
};
