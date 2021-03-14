import { ModelInit, MutableModel, PersistentModelConstructor } from "@aws-amplify/datastore";

export enum ModelAttributeTypes {
  BINARY = "binary",
  BINARY_SET = "binarySet",
  BOOL = "bool",
  LIST = "list",
  MAP = "map",
  NUMBER = "number",
  NUMBER_SET = "numberSet",
  STRING = "string",
  STRING_SET = "stringSet",
  NULL = "_null"
}

export enum ModelSortDirection {
  ASC = "ASC",
  DESC = "DESC"
}

export declare class ModelPostConnection {
  readonly items?: (Post | null)[];
  readonly nextToken?: string;
  readonly startedAt?: number;
  constructor(init: ModelInit<ModelPostConnection>);
}

export declare class Post {
  readonly id: string;
  readonly title: string;
  readonly comments?: ModelCommentConnection;
  readonly mysql_id?: number;
  readonly _version: number;
  readonly _deleted?: boolean;
  readonly _lastChangedAt: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  constructor(init: ModelInit<Post>);
}

export declare class ModelCommentConnection {
  readonly items?: (Comment | null)[];
  readonly nextToken?: string;
  readonly startedAt?: number;
  constructor(init: ModelInit<ModelCommentConnection>);
}

export declare class Comment {
  readonly id: string;
  readonly postID: string;
  readonly post?: Post;
  readonly content: string;
  readonly mysql_id?: number;
  readonly _version: number;
  readonly _deleted?: boolean;
  readonly _lastChangedAt: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  constructor(init: ModelInit<Comment>);
}

