# Datastore with mysql table

## Schema

Generate starting point schema and models from this base model

```graphql
type Post @model(queries: {}) {
  id: ID!
  title: String!
  comments: [Comment] @connection(keyName: "byPost", fields: ["id"])
}

type Comment @model(queries: {}) @key(name: "byPost", fields: ["postID"]) {
  id: ID!
  postID: ID!
  post: Post @connection(fields: ["postID"])
  content: String!
}
```

Then updated the schema with

```graphql
type Query {
  syncPosts(
    filter: ModelPostFilterInput
    limit: Int
    nextToken: String
    lastSync: AWSTimestamp
  ): ModelPostConnection @function(name: "datastoreLink-${env}")
  syncComments(
    filter: ModelCommentFilterInput
    limit: Int
    nextToken: String
    lastSync: AWSTimestamp
  ): ModelCommentConnection @function(name: "datastoreLink-${env}")
}

type Mutation {
  createPost(input: CreatePostInput!, condition: ModelPostConditionInput): Post
    @function(name: "datastoreLink-${env}")
  updatePost(input: UpdatePostInput!, condition: ModelPostConditionInput): Post
    @function(name: "datastoreLink-${env}")
  deletePost(input: DeletePostInput!, condition: ModelPostConditionInput): Post
    @function(name: "datastoreLink-${env}")
  createComment(
    input: CreateCommentInput!
    condition: ModelCommentConditionInput
  ): Comment @function(name: "datastoreLink-${env}")
  updateComment(
    input: UpdateCommentInput!
    condition: ModelCommentConditionInput
  ): Comment @function(name: "datastoreLink-${env}")
  deleteComment(
    input: DeleteCommentInput!
    condition: ModelCommentConditionInput
  ): Comment @function(name: "datastoreLink-${env}")
}
```

Note: The generated models are saved in `./src/models-base/'` for safe-keeping in case `./src/models/` gets overwritten.

Note: the generated resolvers for the Mutation fields needs to be updated as so

```vtl
#if($context.prev.result && $context.prev.result.errorMessage )
    $utils.error($context.prev.result.errorMessage, $context.prev.result.errorType,
    $context.prev.result.data)
#else
    $utils.toJson($context.prev.result.data)
#end
```

The files are updated:

```bash
amplify/backend/api/datastoremysqltodo/resolvers
├── Mutation.createComment.res.vtl
├── Mutation.createPost.res.vtl
├── Mutation.deleteComment.res.vtl
├── Mutation.deletePost.res.vtl
├── Mutation.updateComment.res.vtl
└── Mutation.updatePost.res.vtl
```

## Lambda function

see the definition

## Table Definition

```sql
CREATE TABLE `Posts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `datastore_uuid` varchar(36) NOT NULL,
  `title` varchar(50) NOT NULL,

  `_version` int(11) DEFAULT '1',
  `_deleted` tinyint(1) DEFAULT '0',
  `_lastChangedAt` timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `createdAt` timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `ttl` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `datastore_uuid` (`datastore_uuid`)
) 
```

```sql
CREATE TABLE `Comments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `datastore_uuid` varchar(36) NOT NULL,
  `postID` varchar(36) NOT NULL,
  `content` text NOT NULL,

  `_version` int(11) DEFAULT '1',
  `_deleted` tinyint(1) DEFAULT '0',
  `_lastChangedAt` timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `createdAt` timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `ttl` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `postID` (`postID`),
  CONSTRAINT `post_comments_ibfk_2` FOREIGN KEY (`postID`) REFERENCES `Posts` (`datastore_uuid`)
)
```

## Delta Sync table

TODO! Not implemented yet.

Questions

* do we need a delta sync table in a SQL environment?
* primary key strategy? I'm assuming existing tables are used. datastore should use another field to store the "datastore id". Here we used `datastore_uuid`. Make that an index as well to improve performance?
