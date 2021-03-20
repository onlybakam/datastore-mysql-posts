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

TODO: for simplicity and uniformity, change query response to this format as well

## Lambda function

see the [definition](./amplify/backend/function/datastoreLink/src/index.js)

## SQL

### Table Definition

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
CREATE TABLE `DeltaSyncPosts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `datastore_uuid` varchar(36) NOT NULL,
  `title` varchar(50) NOT NULL,
  `_version` int(11) DEFAULT '1',
  `_deleted` tinyint(1) DEFAULT '0',
  `_lastChangedAt` timestamp(3) NOT NULL,
  `createdAt` timestamp(3) NOT NULL,
  `updatedAt` timestamp(3) NOT NULL,
  `ttl` timestamp(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_version` (`datastore_uuid`,`_lastChangedAt`,`_version`)
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
  KEY `datastore_uuid` (`datastore_uuid`)
  KEY `postID` (`postID`),
  CONSTRAINT `post_comments_ibfk_1` FOREIGN KEY (`postID`) REFERENCES `Posts` (`datastore_uuid`)
)
```

```sql
CREATE TABLE `DeltaSyncComments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `datastore_uuid` varchar(36) NOT NULL,
  `postID` varchar(36) NOT NULL,
  `content` text NOT NULL,

  `_version` int(11) NOT NULL
  `_deleted` tinyint(1) NOT NULL,
  `_lastChangedAt` timestamp(3) NOT NULL,
  `createdAt` timestamp(3) NOT NULL,
  `updatedAt` timestamp(3) NOT NULL,
  `ttl` timestamp(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_version` (`datastore_uuid`,`_lastChangedAt`,`_version`),
  KEY `postID` (`postID`),
  CONSTRAINT `post_comments_ibfk_a` FOREIGN KEY (`postID`) REFERENCES `Posts` (`datastore_uuid`)
)
```

### Events

```sql
DELIMITER |

CREATE EVENT `process_deleted_items` ON SCHEDULE EVERY 1 DAY COMMENT 'purge deleted items' DO 
BEGIN
DELETE FROM
  Comments
WHERE
  _deleted = TRUE
  AND ttl <= CURRENT_TIMESTAMP(3);

DELETE FROM
  DeltaSyncPosts
WHERE
  ttl <= CURRENT_TIMESTAMP(3);

DELETE FROM
  DeltaSyncComments
WHERE
  ttl <= CURRENT_TIMESTAMP(3);

DELETE FROM
  Posts
WHERE
  _deleted = TRUE
  AND ttl <= CURRENT_TIMESTAMP(3);
END |

DELIMITER;
```

## Delta Sync table

- [x] TODO! Not implemented yet.
  - done

Questions

- [x] do we need a delta sync table in a SQL environment?
- [] primary key strategy? I'm assuming existing tables are used. datastore should use another field to store the "datastore id". Here we used `datastore_uuid`. Make that an index as well to improve performance?
