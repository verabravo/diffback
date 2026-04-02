export interface FileComment {
  id: string;
  line: string | null; // "42" or "15-22" for ranges, null for general
  text: string;
  suggestion: string | null;
}

export interface ArchivedComment extends FileComment {
  archivedAt: string;
  round: number;
}

export interface FileReview {
  status: "pending" | "reviewed" | "has-feedback";
  hash: string;
  comments: FileComment[];
  archivedComments?: ArchivedComment[];
  changedSinceReview?: boolean;
}

export interface GeneralComment {
  id: string;
  text: string;
}

export interface ReviewState {
  round: number;
  files: Record<string, FileReview>;
  generalComments: GeneralComment[];
}

export interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions?: number;
  deletions?: number;
  oldPath?: string;
}
