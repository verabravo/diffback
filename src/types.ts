export interface FileComment {
  id: string;
  line: number | null;
  text: string;
  suggestion: string | null;
}

export interface FileReview {
  status: "pending" | "reviewed" | "has-feedback";
  hash: string;
  comments: FileComment[];
  changedSinceReview?: boolean;
}

export interface GeneralComment {
  id: string;
  text: string;
}

export interface ReviewState {
  files: Record<string, FileReview>;
  generalComments: GeneralComment[];
}

export interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed";
  oldPath?: string;
}
