export type SourceRecord = {
  id: string;
  slug: string;
  name: string;
  feedUrl: string;
  siteUrl: string | null;
  defaultCategoryId: string | null;
  enabled: boolean;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  category: { id: string; slug: string; name: string; color: string | null } | null;
  createdAt: Date;
};

export type SourceInput = {
  slug?: string;
  name: string;
  feedUrl: string;
  siteUrl?: string | null;
  defaultCategoryId?: string | null;
  enabled?: boolean;
};

export type SourcePatch = Partial<SourceInput>;
