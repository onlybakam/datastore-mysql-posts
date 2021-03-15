// @ts-check
import { initSchema } from '@aws-amplify/datastore';
import { schema } from './schema';



const { Post, Comment } = initSchema(schema);

export {
  Post,
  Comment
};