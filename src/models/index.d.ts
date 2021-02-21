import { ModelInit, MutableModel, PersistentModelConstructor } from "@aws-amplify/datastore";





export declare class Post {
  readonly id: string;
  readonly title: string;
  readonly comments?: (Comment | null)[];
  constructor(init: ModelInit<Post>);
  static copyOf(source: Post, mutator: (draft: MutableModel<Post>) => MutableModel<Post> | void): Post;
}

export declare class Comment {
  readonly id: string;
  readonly post?: Post;
  readonly content: string;
  constructor(init: ModelInit<Comment>);
  static copyOf(source: Comment, mutator: (draft: MutableModel<Comment>) => MutableModel<Comment> | void): Comment;
}